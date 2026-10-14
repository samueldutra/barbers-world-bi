"""
Grava a MARCA (`brand`) de produtos da Nuvemshop (ESCRITA, só o campo brand) — correção pontual/restauração, com travas.

Entrada (disparo manual do etl-hourly.yml, campo gravar_marca_nuvemshop, com apenas_nuvemshop marcado):
  MARCA_PLANO = "PRODUTO_NS:MARCA_ATUAL_ESPERADA:MARCA_NOVA|..."  (a marca atual esperada evita sobrescrever outra mudança feita no meio tempo)

Por produto: lê o produto AO VIVO; só grava se a marca atual for a esperada; PUT só com {"brand": ...}; relê e confere (marca nova;
categorias e publicação intactas); espelha em barbers.nuvemshop_produtos e audita em barbers.nuvemshop_alteracoes_marca_categoria.
"""

import importlib.util
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
            produto, atual, nova = parte.split(":", 2)
            itens.append((int(produto), atual, nova))
        except ValueError:
            base.log(f"[ERRO] Item inválido (esperado PRODUTO_NS:MARCA_ATUAL_ESPERADA:MARCA_NOVA): '{parte}'")
            sys.exit(1)
    return itens


def ids_categorias(produto: dict):
    return sorted(int(c["id"]) for c in (produto.get("categories") or []) if isinstance(c, dict) and c.get("id") is not None)


def main():
    cliente = os.getenv("ETL_CLIENTE")
    plano = ler_plano(os.getenv("MARCA_PLANO", "").strip())
    if not cliente or not plano:
        base.log("[ERRO] ETL_CLIENTE e MARCA_PLANO são obrigatórios")
        sys.exit(1)
    config = base.obter_configuracoes_clientes().get(cliente)
    if not config:
        base.log(f"[ERRO] Cliente '{cliente}' não encontrado")
        sys.exit(1)
    schema = config["schema"]
    url = f"{base.SUPABASE_URL}/rest/v1/canais_integracoes?plataforma=eq.nuvemshop&status=eq.conectado&select=store_id,access_token"
    resp = base.get_http_session().get(url, headers=base._supabase_headers(), timeout=30)
    resp.raise_for_status()
    lojas = [l for l in resp.json() if l.get("access_token")]
    if len(lojas) != 1:
        base.log(f"[ERRO] Esperava 1 loja conectada; achei {len(lojas)}")
        sys.exit(1)
    store, token = int(lojas[0]["store_id"]), lojas[0]["access_token"]
    base.log("=" * 60)
    base.log(f"MARCA -> NUVEMSHOP — ESCRITA | loja {store} | {len(plano)} produto(s) (só o campo brand)")
    base.log("=" * 60)

    erros = 0
    for n, (pid, esperada, nova) in enumerate(plano, 1):
        caminho = f"/{store}/products/{pid}"
        resultado, motivo, anterior, categorias_novas = "erro", None, None, None
        try:
            status, antes = est.nuvemshop("GET", token, f"{caminho}?fields=id,name,brand,categories,published")
            if status != 200:
                raise RuntimeError(f"GET falhou ({status}): {str(antes)[:200]}")
            anterior = antes.get("brand")
            if est.norm(anterior) == est.norm(nova) and anterior == nova:
                resultado, motivo = "pulado", "já está com essa marca"
            elif est.norm(anterior) != est.norm(esperada):
                resultado, motivo = "pulado", f"a marca atual ({anterior!r}) não é a esperada ({esperada!r}) — não sobrescrevo"
            else:
                status, resposta = est.nuvemshop("PUT", token, caminho, {"brand": nova})
                if status >= 400:
                    raise RuntimeError(f"PUT recusado ({status}): {str(resposta)[:250]}")
                status, depois = est.nuvemshop("GET", token, f"{caminho}?fields=id,name,brand,categories,published")
                if status != 200:
                    raise RuntimeError(f"GET de conferência falhou ({status})")
                categorias_novas = ids_categorias(depois)
                if depois.get("brand") != nova:
                    raise RuntimeError(f"a marca não ficou como esperado: {depois.get('brand')!r} (esperado {nova!r})")
                # A Nuvemshop completa sozinha a cadeia de categorias-pai de um produto a qualquer gravação (ex.: acrescenta "MARCAS"
                # a quem tinha só "WAHL"). Isso é aceito e avisado; REMOVER categoria ou mudar a publicação continua sendo erro.
                categorias_antes = ids_categorias(antes)
                removidas = sorted(set(categorias_antes) - set(categorias_novas))
                if removidas or depois.get("published") != antes.get("published"):
                    raise RuntimeError(f"CATEGORIAS REMOVIDAS ({removidas}) OU PUBLICAÇÃO MUDOU durante a gravação")
                acrescidas = sorted(set(categorias_novas) - set(categorias_antes))
                if acrescidas:
                    base.log(f"  [AVISO] a Nuvemshop acrescentou categorias-pai ao produto {pid}: {acrescidas}")
                resultado = "sucesso"
        except Exception as e:
            motivo = str(e)
        base.log(f"[{n}/{len(plano)}] produto {pid}: {anterior!r} -> {nova!r}: {resultado.upper()}{' — ' + motivo if motivo else ''}")
        if resultado == "erro":
            erros += 1
        if resultado == "sucesso":
            try:
                base.rpc_supabase_com_retry("espelhar_marca_categoria_nuvemshop", {
                    "p_schema_name": schema, "p_store_id": store, "p_id_produto": pid, "p_atualizar_marca": True, "p_marca": nova,
                    "p_atualizar_categorias": False, "p_categorias_ids": None})
            except Exception as e:
                base.log(f"  [AVISO] espelho não atualizado: {e}")
        if resultado != "pulado":
            try:
                base.rpc_supabase_com_retry("registrar_alteracao_marca_categoria", {
                    "p_schema_name": schema, "p_store_id": store, "p_id_produto_ns": pid, "p_marca_anterior": anterior, "p_marca_nova": nova,
                    "p_categorias_anteriores": None, "p_categorias_novas": categorias_novas, "p_sucesso": resultado == "sucesso",
                    "p_erro": motivo, "p_usuario_id": None, "p_usuario_email": "etl:gravar-marca-nuvemshop"})
            except Exception as e:
                base.log(f"  [AVISO] auditoria não gravada: {e}")
        time.sleep(0.2)
    base.log("=" * 60)
    base.log(f"RESUMO: {len(plano) - erros} ok/pulados | {erros} erro(s)")
    if erros:
        sys.exit(2)


if __name__ == "__main__":
    main()
