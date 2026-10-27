"""
Grava o SKU do Bling nas variantes da Nuvemshop (ESCRITA). O SKU DO BLING É A FONTE DA VERDADE: a variante passa a usar o código exato de um
produto ativo do Bling. Só o campo `sku` é gravado — preço, promoção, estoque e publicação nunca.

Entrada (disparo manual do etl-hourly.yml):
  SKU_PLANO  = "PRODUTO_NS:VARIANTE_NS:CODIGO_BLING|PRODUTO_NS:VARIANTE_NS:CODIGO_BLING|..." (lista decidida e conferida pelo usuário)
  SKU_LIMITE = quantas variantes processar neste disparo (1 = teste). Itens já gravados são pulados e não contam.

Travas por variante (nada é gravado se alguma falhar): o código existe em exatamente 1 produto ATIVO do Bling e não é usado por outra variante
da Nuvemshop (RPC validar_sku_vinculo_nuvemshop); a variante existe e o SKU atual difere do alvo; PUT só com {"sku"}; relê e confere
(SKU novo; preço, promoção, estoque da variante e publicação do produto intactos). Auditoria em barbers.nuvemshop_alteracoes_sku.
3 erros seguidos interrompem o lote.

Reaproveita a infraestrutura de sync-estoque-bling-nuvemshop.py (sessão Supabase, Nuvemshop com limitador).
"""

import importlib.util
import json
import os
import sys
import time

_spec = importlib.util.spec_from_file_location("sync_estoque", os.path.join(os.path.dirname(__file__), "sync-estoque-bling-nuvemshop.py"))
est = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(est)
base = est.base


def ler_plano(bruto: str):
    itens = []
    for parte in bruto.split("|"):
        parte = parte.strip()
        if not parte:
            continue
        try:
            produto, variante, codigo = parte.split(":", 2)
            itens.append((int(produto), int(variante), codigo.strip()))
        except ValueError:
            base.log(f"[ERRO] Item do plano inválido (esperado PRODUTO_NS:VARIANTE_NS:CODIGO): '{parte}'")
            sys.exit(1)
    if len({v for _, v, _ in itens}) != len(itens):
        base.log("[ERRO] O plano repete uma variante.")
        sys.exit(1)
    if len({est.norm(c) for _, _, c in itens}) != len(itens):
        base.log("[ERRO] O plano repete um código (duas variantes ficariam com o mesmo SKU).")
        sys.exit(1)
    return itens


def loja_conectada():
    url = f"{base.SUPABASE_URL}/rest/v1/canais_integracoes?{base.filtro_tenant_canais()}plataforma=eq.nuvemshop&status=eq.conectado&select=store_id,access_token"
    resp = base.get_http_session().get(url, headers=base._supabase_headers(), timeout=30)
    resp.raise_for_status()
    linhas = [l for l in resp.json() if l.get("access_token")]
    if len(linhas) != 1:
        base.log(f"[ERRO] Esperava exatamente 1 loja Nuvemshop conectada; achei {len(linhas)}.")
        sys.exit(1)
    return int(linhas[0]["store_id"]), linhas[0]["access_token"]


def processar(schema, store_id, token, produto, variante, codigo):
    """Devolve (resultado, motivo, sku_anterior, sku_gravado, id_produto_bling)."""
    v = est.rpc_json("validar_sku_vinculo_nuvemshop", {"p_schema_name": schema, "p_sku": codigo, "p_id_variante": variante})
    v = v[0] if isinstance(v, list) and v else v
    if not v or int(v["qtd_bling"]) == 0:
        return "pulado", f"o código '{codigo}' não existe em produto ativo do Bling", None, None, None
    if int(v["qtd_bling"]) > 1:
        return "pulado", f"o código '{codigo}' está em {v['qtd_bling']} produtos do Bling", None, None, None
    if int(v["qtd_outras_variantes_ns"]) > 0:
        return "pulado", f"o código '{v['codigo_bling']}' já é usado por outra variante da Nuvemshop", None, None, int(v["id_produto_bling"])
    codigo_bling, id_bling = str(v["codigo_bling"]).strip(), int(v["id_produto_bling"])
    if est.norm(codigo_bling) != est.norm(codigo):
        return "pulado", f"o plano diz '{codigo}' mas o Bling tem '{codigo_bling}'", None, None, id_bling

    caminho_prod = f"/{store_id}/products/{produto}"
    caminho = f"{caminho_prod}/variants/{variante}"
    status, antes = est.nuvemshop("GET", token, caminho)
    if status != 200:
        return "erro", f"GET variante falhou ({status}): {str(antes)[:200]}", None, None, id_bling
    sku_anterior = antes.get("sku")
    if est.norm(sku_anterior) == est.norm(codigo_bling) and sku_anterior == codigo_bling:
        return "pulado", "já está com o SKU do Bling", sku_anterior, codigo_bling, id_bling
    status, prod_antes = est.nuvemshop("GET", token, caminho_prod)
    if status != 200:
        return "erro", f"GET produto falhou ({status})", sku_anterior, None, id_bling

    status, resposta = est.nuvemshop("PUT", token, caminho, {"sku": codigo_bling})
    if status >= 400:
        return "erro", f"PUT recusado ({status}): {json.dumps(resposta, ensure_ascii=False)[:250]}", sku_anterior, codigo_bling, id_bling

    status, depois = est.nuvemshop("GET", token, caminho)
    if status != 200:
        return "erro", f"GET de conferência falhou ({status})", sku_anterior, codigo_bling, id_bling
    status, prod_depois = est.nuvemshop("GET", token, caminho_prod)
    if depois.get("sku") != codigo_bling:
        return "erro", f"SKU não ficou como esperado: {depois.get('sku')!r} (esperado {codigo_bling!r})", sku_anterior, codigo_bling, id_bling
    for campo in ("price", "promotional_price", "stock", "stock_management"):
        if depois.get(campo) != antes.get(campo):
            return "erro", f"{campo.upper()} MUDOU: {antes.get(campo)!r} -> {depois.get(campo)!r}", sku_anterior, codigo_bling, id_bling
    if status == 200 and prod_depois.get("published") != prod_antes.get("published"):
        return "erro", f"PUBLICAÇÃO MUDOU: {prod_antes.get('published')!r} -> {prod_depois.get('published')!r}", sku_anterior, codigo_bling, id_bling
    return "sucesso", None, sku_anterior, codigo_bling, id_bling


def main():
    cliente = os.getenv("ETL_CLIENTE")
    plano_bruto = os.getenv("SKU_PLANO", "").strip()
    limite = int(os.getenv("SKU_LIMITE", "0") or 0)
    if not cliente or not plano_bruto or limite <= 0:
        base.log("[ERRO] ETL_CLIENTE, SKU_PLANO e SKU_LIMITE (> 0) são obrigatórios")
        sys.exit(1)
    config = base.obter_configuracoes_clientes().get(cliente)
    if not config:
        base.log(f"[ERRO] Cliente '{cliente}' não encontrado")
        sys.exit(1)
    schema = config["schema"]
    plano = ler_plano(plano_bruto)
    store_id, token = loja_conectada()
    base.log("=" * 60)
    base.log(f"SKU BLING -> NUVEMSHOP — ESCRITA | loja {store_id} | {len(plano)} item(ns) no plano | limite {limite} (só o campo sku)")
    base.log("=" * 60)

    contagem, auditoria, seguidos, inicio, gravados_neste = {"sucesso": 0, "pulado": 0, "erro": 0}, [], 0, time.time(), 0
    for n, (produto, variante, codigo) in enumerate(plano, 1):
        if gravados_neste >= limite:
            break
        try:
            resultado, motivo, anterior, gravado, id_bling = processar(schema, store_id, token, produto, variante, codigo)
        except Exception as e:  # erro inesperado numa variante não derruba o lote
            resultado, motivo, anterior, gravado, id_bling = "erro", f"exceção: {e}", None, None, None
        contagem[resultado] += 1
        if resultado == "sucesso":
            gravados_neste += 1
        seguidos = seguidos + 1 if resultado == "erro" else 0
        base.log(f"[{n}/{len(plano)}] variante {variante}: {anterior!r} -> {codigo!r}: {resultado.upper()}{' — ' + motivo if motivo else ''}")
        if resultado != "pulado":
            try:
                base.rpc_supabase_com_retry("registrar_alteracao_sku_nuvemshop", {
                    "p_schema_name": schema, "p_store_id": store_id, "p_id_produto_ns": produto, "p_id_variante": variante,
                    "p_sku_anterior": anterior, "p_sku_novo": (gravado or codigo)[:100], "p_id_produto_bling": id_bling,
                    "p_origem": "escolha", "p_sucesso": resultado == "sucesso", "p_erro": motivo,
                    "p_usuario_id": None, "p_usuario_email": "etl:aplicar-sku-nuvemshop"})
            except Exception as e:
                base.log(f"  [AVISO] auditoria não gravada para a variante {variante}: {e}")
        if seguidos >= 3:
            base.log("INTERROMPIDO: 3 erros seguidos.")
            break
    base.log("=" * 60)
    base.log(f"RESUMO: gravados {contagem['sucesso']} | pulados {contagem['pulado']} | erros {contagem['erro']} | {time.time() - inicio:.0f}s")
    if contagem["erro"]:
        sys.exit(2)


if __name__ == "__main__":
    main()
