"""
Grava os TÍTULOS padronizados das máquinas (barbers.titulos_propostas, só status APROVADO) na Nuvemshop e/ou no Bling (ESCRITA).
Só o NOME do produto é alterado — preço, estoque, SKU, categorias, marca e publicação nunca.

Entrada (disparo manual do etl-hourly.yml):
  TITULOS_LIMITE  = quantos produtos processar neste disparo (por sistema)        (1 = teste)
  TITULOS_SISTEMA = nuvemshop | bling | ambos | reverter-bling-cosmetico                                     (padrão: ambos)

Travas por produto (nada é gravado se alguma falhar):
  - o nome AO VIVO no sistema ainda é o que a proposta tomou como "atual" (senão pula: alguém mudou o nome no meio tempo);
  - Nuvemshop: o PUT leva o `handle` (endereço/URL do produto) igual ao atual, para que renomear NÃO mude o link; relê e confere nome,
    handle, publicação e preço/promoção/estoque/SKU de todas as variantes intactos;
  - Bling: PATCH só com {"nome"}; relê e confere nome, código e preço intactos.
Auditoria em barbers.titulos_alteracoes; a linha de barbers.titulos_propostas ganha aplicado_em / aplicado_bling_em.
3 erros seguidos interrompem. Reaproveita a infraestrutura de sync-estoque-bling-nuvemshop.py e vincular-lote-loja-bling.py.
"""

import importlib.util
import json
import os
import sys
import time
import unicodedata

_dir = os.path.dirname(__file__)
_spec = importlib.util.spec_from_file_location("sync_estoque", os.path.join(_dir, "sync-estoque-bling-nuvemshop.py"))
est = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(est)
_spec2 = importlib.util.spec_from_file_location("vinc_lote", os.path.join(_dir, "vincular-lote-loja-bling.py"))
vl = importlib.util.module_from_spec(_spec2)
_spec2.loader.exec_module(vl)
base = est.base

ERROS_SEGUIDOS_MAX = 3


def n(texto) -> str:
    """Compara nomes sem diferença de acento decomposto, maiúscula ou espaço."""
    return " ".join(unicodedata.normalize("NFC", str(texto or "")).split()).upper()


def nome_pt(valor):
    return valor.get("pt") if isinstance(valor, dict) else valor


def estado_variantes(produto: dict):
    return sorted(
        (v.get("id"), v.get("sku"), v.get("price"), v.get("promotional_price"), v.get("stock")) for v in (produto.get("variants") or [])
    )


def aplicar_nuvemshop(cliente, schema, linhas):
    store = None
    status, _ = 0, None
    url = f"{base.SUPABASE_URL}/rest/v1/canais_integracoes?{base.filtro_tenant_canais()}plataforma=eq.nuvemshop&status=eq.conectado&select=store_id,access_token"
    resp = base.get_http_session().get(url, headers=base._supabase_headers(), timeout=30)
    resp.raise_for_status()
    lojas = [l for l in resp.json() if l.get("access_token")]
    if len(lojas) != 1:
        base.log(f"[ERRO] Esperava 1 loja Nuvemshop conectada; achei {len(lojas)}")
        sys.exit(1)
    store, token = int(lojas[0]["store_id"]), lojas[0]["access_token"]
    return processar(
        "nuvemshop", schema, linhas,
        lambda r: aplicar_um_nuvemshop(store, token, r))


def aplicar_um_nuvemshop(store, token, r):
    pid = int(r["id_produto_ns"])
    caminho = f"/{store}/products/{pid}"
    campos = "id,name,handle,published,variants"
    status, antes = est.nuvemshop("GET", token, f"{caminho}?fields={campos}")
    if status != 200:
        return "erro", f"GET falhou ({status}): {str(antes)[:200]}", None
    vivo = nome_pt(antes.get("name"))
    if n(vivo) == n(r["titulo_proposto"]) and vivo == r["titulo_proposto"]:
        return "pulado", "já está com o título proposto", vivo
    if n(vivo) != n(r["titulo_atual"]):
        return "pulado", f"o nome ao vivo ({vivo!r}) não é o da proposta — alguém mudou; não sobrescrevo", vivo
    corpo = {"name": {"pt": r["titulo_proposto"]}}
    if isinstance(antes.get("handle"), dict) and antes["handle"]:
        corpo["handle"] = antes["handle"]  # fixa o endereço: renomear não muda o link
    status, resposta = est.nuvemshop("PUT", token, caminho, corpo)
    if status >= 400:
        return "erro", f"PUT recusado ({status}): {json.dumps(resposta, ensure_ascii=False)[:250]}", vivo
    status, depois = est.nuvemshop("GET", token, f"{caminho}?fields={campos}")
    if status != 200:
        return "erro", f"GET de conferência falhou ({status})", vivo
    if nome_pt(depois.get("name")) != r["titulo_proposto"]:
        return "erro", f"o nome não ficou como esperado: {nome_pt(depois.get('name'))!r}", vivo
    if depois.get("handle") != antes.get("handle"):
        return "erro", f"O ENDEREÇO (handle) MUDOU: {antes.get('handle')} -> {depois.get('handle')}", vivo
    if depois.get("published") != antes.get("published") or estado_variantes(depois) != estado_variantes(antes):
        return "erro", "PUBLICAÇÃO/PREÇO/ESTOQUE/SKU MUDARAM durante a gravação", vivo
    return "sucesso", None, vivo


def bling(cliente, conta, metodo, path, corpo=None):
    """Chamada ao Bling que ESPERA e tenta de novo no 429 (limite de requisições) — 4 tentativas com espera crescente."""
    for espera in (0, 4, 10, 25):
        if espera:
            time.sleep(espera)
        status, resposta = vl.chamar(cliente, conta, metodo, path, corpo=corpo)
        if status != 429:
            break
    return status, resposta


def aplicar_um_bling(cliente, conta, r):
    pid = int(r["id_produto_bling"])
    status, corpo = bling(cliente, conta, "GET", f"/produtos/{pid}")
    if status != 200:
        return "erro", f"GET falhou ({status}): {str(corpo)[:200]}", None
    antes = corpo.get("data") or {}
    vivo = antes.get("nome")
    if n(vivo) == n(r["titulo_proposto"]) and vivo == r["titulo_proposto"]:
        return "pulado", "já está com o título proposto", vivo
    if r.get("titulo_bling_atual") and n(vivo) != n(r["titulo_bling_atual"]):
        return "pulado", f"o nome ao vivo ({vivo!r}) não é o da proposta — alguém mudou; não sobrescrevo", vivo
    status, resposta = bling(cliente, conta, "PATCH", f"/produtos/{pid}", corpo={"nome": r["titulo_proposto"]})
    if status >= 400:
        return "erro", f"PATCH recusado ({status}): {json.dumps(resposta, ensure_ascii=False)[:250]}", vivo
    status, corpo2 = bling(cliente, conta, "GET", f"/produtos/{pid}")
    if status != 200:
        return "erro", f"GET de conferência falhou ({status})", vivo
    depois = corpo2.get("data") or {}
    if depois.get("nome") != r["titulo_proposto"]:
        return "erro", f"o nome não ficou como esperado: {depois.get('nome')!r}", vivo
    if depois.get("codigo") != antes.get("codigo") or depois.get("preco") != antes.get("preco"):
        return "erro", f"CÓDIGO/PREÇO MUDARAM: {antes.get('codigo')!r}/{antes.get('preco')} -> {depois.get('codigo')!r}/{depois.get('preco')}", vivo
    return "sucesso", None, vivo


def reverter_um_bling(cliente, conta, r):
    """Restaura o nome ORIGINAL do Bling (cosméticos ficam padronizados só na Nuvemshop)."""
    pid = int(r["id_produto_bling"])
    original, aplicado = r["titulo_original"], r["titulo_aplicado"]
    if not original:
        return "erro", "sem título original na auditoria", None
    status, corpo = bling(cliente, conta, "GET", f"/produtos/{pid}")
    if status != 200:
        return "erro", f"GET falhou ({status}): {str(corpo)[:200]}", None
    antes = corpo.get("data") or {}
    vivo = antes.get("nome")
    if vivo == original:
        return "pulado", "já está com o nome original", vivo
    if n(vivo) != n(aplicado):
        return "pulado", f"o nome ao vivo ({vivo!r}) não é o gravado pelo BI — alguém mudou; não sobrescrevo", vivo
    status, resposta = bling(cliente, conta, "PATCH", f"/produtos/{pid}", corpo={"nome": original})
    if status >= 400:
        return "erro", f"PATCH recusado ({status}): {json.dumps(resposta, ensure_ascii=False)[:250]}", vivo
    status, corpo2 = bling(cliente, conta, "GET", f"/produtos/{pid}")
    if status != 200:
        return "erro", f"GET de conferência falhou ({status})", vivo
    depois = corpo2.get("data") or {}
    if depois.get("nome") != original:
        return "erro", f"o nome não ficou como esperado: {depois.get('nome')!r}", vivo
    if depois.get("codigo") != antes.get("codigo") or depois.get("preco") != antes.get("preco"):
        return "erro", "CÓDIGO/PREÇO MUDARAM durante a reversão", vivo
    return "sucesso", None, vivo


def reverter_bling(cliente, schema, conta, familia, limite):
    linhas = vl.rpc_json("obter_titulos_a_reverter_bling", {"p_schema_name": schema, "p_familia": familia, "p_limite": limite})
    base.log(f"Bling (REVERSÃO {familia}): {len(linhas)} produto(s) a restaurar neste disparo.")
    contagem, seguidos = {"sucesso": 0, "pulado": 0, "erro": 0}, 0
    for i, r in enumerate(linhas, 1):
        try:
            resultado, motivo, vivo = reverter_um_bling(cliente, conta, r)
        except Exception as e:
            resultado, motivo, vivo = "erro", f"exceção: {e}", None
        contagem[resultado] += 1
        seguidos = seguidos + 1 if resultado == "erro" else 0
        time.sleep(1.0)
        base.log(f"[bling-rev {i}/{len(linhas)}] {vivo!r} -> {r['titulo_original']!r}: {resultado.upper()}{' — ' + motivo if motivo else ''}")
        if resultado != "pulado":
            try:
                base.rpc_supabase_com_retry("registrar_titulo_revertido_bling", {
                    "p_schema_name": schema, "p_store_id": r.get("store_id"), "p_id_produto_ns": r.get("id_produto_ns"),
                    "p_id_produto_bling": r.get("id_produto_bling"), "p_anterior": vivo, "p_novo": r["titulo_original"],
                    "p_sucesso": resultado == "sucesso", "p_erro": motivo})
            except Exception as e:
                base.log(f"  [AVISO] auditoria não gravada: {e}")
        if seguidos >= ERROS_SEGUIDOS_MAX:
            base.log("INTERROMPIDO: 3 erros seguidos.")
            break
    base.log(f"RESUMO reversão: restaurados {contagem['sucesso']} | pulados {contagem['pulado']} | erros {contagem['erro']}")
    return contagem["erro"]


def processar(sistema, schema, linhas, aplicar_um):
    contagem, seguidos = {"sucesso": 0, "pulado": 0, "erro": 0}, 0
    for i, r in enumerate(linhas, 1):
        try:
            resultado, motivo, vivo = aplicar_um(r)
        except Exception as e:  # erro inesperado num produto não derruba o lote
            resultado, motivo, vivo = "erro", f"exceção: {e}", None
        contagem[resultado] += 1
        seguidos = seguidos + 1 if resultado == "erro" else 0
        if sistema == "bling":
            time.sleep(1.0)  # o PATCH de produto no Bling tem limite próprio mais baixo que o geral
        base.log(f"[{sistema} {i}/{len(linhas)}] {vivo!r} -> {r['titulo_proposto']!r}: {resultado.upper()}{' — ' + motivo if motivo else ''}")
        if resultado != "pulado":
            try:
                base.rpc_supabase_com_retry("registrar_titulo_aplicado", {
                    "p_schema_name": schema, "p_sistema": sistema, "p_store_id": r.get("store_id"), "p_id_produto_ns": r.get("id_produto_ns"),
                    "p_id_produto_bling": r.get("id_produto_bling"), "p_anterior": vivo, "p_novo": r["titulo_proposto"],
                    "p_sucesso": resultado == "sucesso", "p_erro": motivo})
            except Exception as e:
                base.log(f"  [AVISO] auditoria não gravada: {e}")
        if seguidos >= ERROS_SEGUIDOS_MAX:
            base.log("INTERROMPIDO: 3 erros seguidos.")
            break
    base.log(f"RESUMO {sistema}: gravados {contagem['sucesso']} | pulados {contagem['pulado']} | erros {contagem['erro']}")
    return contagem


def main():
    cliente = os.getenv("ETL_CLIENTE")
    limite = int(os.getenv("TITULOS_LIMITE", "0") or 0)
    sistema = (os.getenv("TITULOS_SISTEMA", "ambos") or "ambos").strip().lower()
    if not cliente or limite <= 0 or sistema not in ("nuvemshop", "bling", "ambos", "reverter-bling-cosmetico"):
        base.log("[ERRO] ETL_CLIENTE, TITULOS_LIMITE (> 0) e TITULOS_SISTEMA (nuvemshop|bling|ambos) são obrigatórios")
        sys.exit(1)
    config = base.obter_configuracoes_clientes().get(cliente)
    if not config:
        base.log(f"[ERRO] Cliente '{cliente}' não encontrado")
        sys.exit(1)
    schema, conta = config["schema"], config.get("conta_bling", cliente)
    base.log("=" * 60)
    base.log(f"TÍTULOS DAS MÁQUINAS — ESCRITA | sistema {sistema} | limite {limite} por sistema (só o nome do produto)")
    base.log("=" * 60)
    erros = 0
    inicio = time.time()
    if sistema == "reverter-bling-cosmetico":
        erros = reverter_bling(cliente, schema, conta, "COSMETICO", limite)
        base.log(f"{time.time() - inicio:.0f}s | erros {erros}")
        sys.exit(2 if erros else 0)
    if sistema in ("nuvemshop", "ambos"):
        linhas = vl.rpc_json("obter_titulos_a_aplicar", {"p_schema_name": schema, "p_sistema": "nuvemshop", "p_limite": limite})
        base.log(f"Nuvemshop: {len(linhas)} produto(s) a gravar neste disparo.")
        erros += aplicar_nuvemshop(cliente, schema, linhas)["erro"]
    if sistema in ("bling", "ambos"):
        linhas = vl.rpc_json("obter_titulos_a_aplicar", {"p_schema_name": schema, "p_sistema": "bling", "p_limite": limite})
        base.log(f"Bling: {len(linhas)} produto(s) a gravar neste disparo.")
        erros += processar("bling", schema, linhas, lambda r: aplicar_um_bling(cliente, conta, r))["erro"]
    base.log(f"{time.time() - inicio:.0f}s | erros {erros}")
    if erros:
        sys.exit(2)


if __name__ == "__main__":
    main()
