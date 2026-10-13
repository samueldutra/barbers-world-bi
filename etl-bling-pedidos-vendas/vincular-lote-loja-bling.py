"""
LOTE de vínculos produto x loja do Bling — ESCRITA. Grava o "ID na loja" (`codigo` = ID do PRODUTO na Nuvemshop) nos produtos do
Bling cujo SKU é idêntico ao de uma variante da Nuvemshop e que ainda não têm vínculo na loja ('criar') ou têm o ID 0/inexistente
('corrigir'). SKU do Bling manda. Os candidatos vêm de obter_vinculos_a_gravar() (já sem os casos que pedem decisão: produto da
Nuvemshop com várias variantes, estoque sem controle, saldo negativo, item que a loja zeraria ou reabriria).

REGRA: preços NUNCA mudam. O cadastro do produto só é lido (e relido pra provar que não mudou); o preço do vínculo espelha o que a
loja já pratica (preco = preço da Nuvemshop; precoPromocional = promoção da loja, ou 0).

Travas por produto, na hora de gravar (se falhar, PULA e registra o motivo): produto ativo; SKU do Bling ainda idêntico ao da
variante; estado do vínculo ainda é o esperado (nenhum / o ID quebrado esperado); saldo AO VIVO do Bling não cai nos casos de decisão.
Depois de gravar relê o vínculo (codigo e preços) e o cadastro (preço). 3 erros seguidos interrompem o lote.
Cada tentativa é registrada em barbers.vinculos_lojas_alteracoes (auditoria; sucesso sai da lista de candidatos).

Roda pelo disparo manual do etl-hourly.yml (campo vincular_lote = quantos produtos processar neste disparo, ex.: "20").
Reaproveita a sessão/OAuth de sync-canais-venda-bling.py (duplicação de infraestrutura já é a convenção desta pasta).
"""

import importlib.util
import json
import os
import sys
import time
import traceback

_spec = importlib.util.spec_from_file_location("sync_canais", os.path.join(os.path.dirname(__file__), "sync-canais-venda-bling.py"))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)

LOJA = 206304549  # NUVEMSHOP BARBERS WORLD (barbers.canais_venda.id_loja)
ERROS_SEGUIDOS_MAX = 3


def chamar(cliente, conta, metodo, path, params=None, corpo=None):
    """Chamada ao Bling com renovação de token em 401. Devolve (status, json|texto)."""
    for tentativa in range(2):
        token = base.obter_access_token_valido(cliente, conta, forcar_refresh=(tentativa > 0))
        base.bling_rate_limiter.aguardar()
        resp = base.get_http_session().request(
            metodo, f"{base.BLING_BASE_URL}{path}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json", "Content-Type": "application/json"},
            params=params or {}, data=json.dumps(corpo) if corpo is not None else None, timeout=60)
        if resp.status_code == 401 and tentativa == 0:
            continue
        try:
            return resp.status_code, resp.json()
        except ValueError:
            return resp.status_code, resp.text[:500]
    return 401, "401 mesmo após renovar o token"


def ler(cliente, conta, path, params=None):
    status, corpo = chamar(cliente, conta, "GET", path, params)
    if status >= 400:
        raise RuntimeError(f"GET {path} falhou ({status}): {str(corpo)[:300]}")
    return corpo


def rpc_json(nome, payload):
    resp = base.get_http_session().post(f"{base.SUPABASE_URL}/rest/v1/rpc/{nome}", json=payload, headers=base._supabase_headers(), timeout=120)
    resp.raise_for_status()
    return resp.json()


def norm(sku):
    return " ".join(str(sku or "").split()).upper()


def saldos_ao_vivo(cliente, conta, ids):
    saldos = {}
    for i in range(0, len(ids), 100):
        corpo = ler(cliente, conta, "/estoques/saldos", [("idsProdutos[]", pid) for pid in ids[i:i + 100]])
        for item in corpo.get("data") or []:
            saldos[int(item["produto"]["id"])] = float(item.get("saldoVirtualTotal") or 0)
    return saldos


def processar(cliente, conta, c, saldo_vivo, verificar_cadastro):
    """Processa um candidato. Devolve (resultado, motivo, detalhes) — resultado: sucesso | pulado | erro."""
    pid, acao = int(c["id_produto_bling"]), c["acao"]
    novo = str(c["id_produto_ns"])
    preco = float(c["preco_ns"] or 0)
    promo = float(c["promo_ns"] or 0)
    ns_estoque = float(c["estoque_ns"])
    det = {"acao": acao, "codigo_anterior": c.get("codigo_vinculo_atual"), "codigo_novo": novo, "preco": preco,
           "preco_promocional": promo, "id_vinculo": c.get("id_vinculo")}

    produto = ler(cliente, conta, f"/produtos/{pid}")["data"]
    if produto.get("situacao") != "A":
        return "pulado", "produto não está ativo", det
    if norm(produto.get("codigo")) != norm(c["sku_ns"]):
        return "pulado", f"SKU do Bling ({produto.get('codigo')}) não é mais idêntico ao da Nuvemshop ({c['sku_ns']})", det

    vinculos = ler(cliente, conta, "/produtos/lojas", {"idProduto": pid}).get("data") or []
    da_loja = [v for v in vinculos if (v.get("loja") or {}).get("id") == LOJA]
    if len(da_loja) > 1:
        return "pulado", "mais de um vínculo na loja", det
    existente = da_loja[0] if da_loja else None
    if acao == "criar":
        if existente is not None:
            if str(existente.get("codigo")) == novo:
                return "pulado", "já está vinculado com o ID certo", det
            return "pulado", f"já existe vínculo (ID {existente.get('codigo')}) — não era esperado", det
    else:  # corrigir: só troca o ID quebrado esperado
        if existente is None or str(existente.get("codigo")) != str(c.get("codigo_vinculo_atual")):
            return "pulado", "o vínculo mudou desde a análise", det
        det["id_vinculo"] = existente["id"]

    saldo = saldo_vivo.get(pid)
    if saldo is None:
        return "pulado", "sem saldo de estoque no Bling", det
    if saldo < 0:
        return "pulado", "saldo negativo no Bling", det
    if ns_estoque > 0 and saldo == 0:
        return "pulado", "zeraria o item na loja (loja com estoque, Bling em zero)", det
    if ns_estoque == 0 and saldo > 0:
        return "pulado", "reabriria a venda (loja em zero, Bling com saldo)", det

    corpo = {
        "codigo": novo, "preco": preco, "precoPromocional": promo,
        "produto": {"id": pid}, "loja": {"id": LOJA},
        "fornecedorLoja": {"id": (existente or {}).get("fornecedorLoja", {}).get("id", 0) or 0},
        "marcaLoja": {"id": (existente or {}).get("marcaLoja", {}).get("id", 0) or 0},
        "categoriasProdutos": [{"id": cat["id"]} for cat in ((existente or {}).get("categoriasProdutos") or [])],
    }
    metodo, path = ("PUT", f"/produtos/lojas/{existente['id']}") if acao == "corrigir" else ("POST", "/produtos/lojas")
    status, resposta = chamar(cliente, conta, metodo, path, corpo=corpo)
    if status >= 400:
        return "erro", f"{metodo} {path} recusado ({status}): {json.dumps(resposta, ensure_ascii=False)[:300]}", det
    if isinstance(resposta, dict) and (resposta.get("data") or {}).get("id"):
        det["id_vinculo"] = resposta["data"]["id"]

    depois = [v for v in (ler(cliente, conta, "/produtos/lojas", {"idProduto": pid}).get("data") or []) if (v.get("loja") or {}).get("id") == LOJA]
    ok = (len(depois) == 1 and str(depois[0].get("codigo")) == novo and abs(float(depois[0].get("preco") or 0) - preco) < 0.005
          and abs(float(depois[0].get("precoPromocional") or 0) - promo) < 0.005)
    if not ok:
        return "erro", f"vínculo não ficou como esperado ao reler: {json.dumps(depois, ensure_ascii=False)[:300]}", det
    if verificar_cadastro:
        apos = ler(cliente, conta, f"/produtos/{pid}")["data"]
        if abs(float(apos.get("preco") or 0) - float(produto.get("preco") or 0)) > 0.005 or apos.get("codigo") != produto.get("codigo"):
            return "erro", f"CADASTRO MUDOU: preço {produto.get('preco')}->{apos.get('preco')} código {produto.get('codigo')}->{apos.get('codigo')}", det
    return "sucesso", None, det


def main():
    cliente = os.getenv("ETL_CLIENTE")
    try:
        limite = int(os.getenv("LOTE_LIMITE", "0"))
    except ValueError:
        limite = 0
    if not cliente or limite <= 0:
        base.log("[ERRO] ETL_CLIENTE e LOTE_LIMITE (> 0) são obrigatórios")
        sys.exit(1)
    verificar = os.getenv("LOTE_VERIFICAR_CADASTRO", "1") == "1"
    config = base.obter_configuracoes_clientes().get(cliente, {})
    schema, conta = config["schema"], config.get("conta_bling", cliente)

    base.log("=" * 60)
    base.log(f"LOTE DE VÍNCULOS PRODUTO x LOJA (BLING) — ESCRITA | loja {LOJA} | limite {limite} | releitura do cadastro: {verificar}")
    base.log("=" * 60)

    candidatos = []
    while True:
        pagina = rpc_json("obter_vinculos_a_gravar", {"p_schema_name": schema, "p_id_loja": LOJA, "p_offset": len(candidatos), "p_limite": 1000})
        candidatos.extend(pagina)
        if len(pagina) < 1000:
            break
    base.log(f"{len(candidatos)} candidato(s) a gravar; este disparo processa {min(limite, len(candidatos))}.")
    lote = candidatos[:limite]
    if not lote:
        base.log("Nada a fazer.")
        return

    saldos = saldos_ao_vivo(cliente, conta, [int(c["id_produto_bling"]) for c in lote])
    contagem, pulados, auditoria, seguidos_erro = {"sucesso": 0, "pulado": 0, "erro": 0}, {}, [], 0
    inicio = time.time()

    def gravar_auditoria():
        if auditoria:
            base.rpc_supabase_com_retry("registrar_vinculos_lojas_alteracoes", {"p_data_json": list(auditoria), "p_schema_name": schema})
            auditoria.clear()

    try:
        for n, c in enumerate(lote, 1):
            try:
                resultado, motivo, det = processar(cliente, conta, c, saldos, verificar)
            except Exception as e:  # erro inesperado num produto não derruba o lote inteiro
                resultado, motivo, det = "erro", f"exceção: {e}", {"acao": c["acao"], "codigo_novo": str(c["id_produto_ns"])}
            contagem[resultado] += 1
            if resultado == "pulado":
                pulados.setdefault(motivo, []).append(c["codigo_bling"])
            seguidos_erro = seguidos_erro + 1 if resultado == "erro" else 0
            base.log(f"[{n}/{len(lote)}] {c['codigo_bling']} (Bling {c['id_produto_bling']}) {c['acao']} -> ID {c['id_produto_ns']}: "
                     f"{resultado.upper()}{' — ' + motivo if motivo else ''}")
            auditoria.append({"id_produto_bling": int(c["id_produto_bling"]), "id_loja": LOJA, "resultado": resultado, "motivo": motivo, **det})
            if len(auditoria) >= 20:
                gravar_auditoria()
            if seguidos_erro >= ERROS_SEGUIDOS_MAX:
                base.log(f"INTERROMPIDO: {ERROS_SEGUIDOS_MAX} erros seguidos.")
                break
    finally:
        gravar_auditoria()

    base.log("=" * 60)
    base.log(f"RESUMO: gravados {contagem['sucesso']} | pulados {contagem['pulado']} | erros {contagem['erro']} | {time.time() - inicio:.0f}s")
    for motivo, skus in pulados.items():
        base.log(f"  pulados ({len(skus)}): {motivo} -> {', '.join(skus[:15])}{' …' if len(skus) > 15 else ''}")
    if contagem["erro"]:
        sys.exit(2)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        base.log(f"Execução falhou: {e}")
        traceback.print_exc()
        sys.exit(1)
