"""
Diagnóstico SOMENTE LEITURA de produtos da Nuvemshop: mostra, direto da API, a marca (`brand`), as categorias e quem é o pai de cada
categoria. Nada é gravado. Entrada: DIAG_PRODUTOS = ids de produto da Nuvemshop separados por vírgula.
Roda pelo disparo manual do etl-hourly.yml (campo diagnosticar_produto_nuvemshop, com apenas_nuvemshop marcado).
"""

import importlib.util
import json
import os
import sys

_spec = importlib.util.spec_from_file_location("sync_estoque", os.path.join(os.path.dirname(__file__), "sync-estoque-bling-nuvemshop.py"))
est = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(est)
base = est.base


def main():
    ids = [int(x) for x in os.getenv("DIAG_PRODUTOS", "").replace(" ", "").split(",") if x]
    if not ids:
        base.log("[ERRO] DIAG_PRODUTOS vazio")
        sys.exit(1)
    url = f"{base.SUPABASE_URL}/rest/v1/canais_integracoes?plataforma=eq.nuvemshop&status=eq.conectado&select=store_id,access_token"
    resp = base.get_http_session().get(url, headers=base._supabase_headers(), timeout=30)
    resp.raise_for_status()
    lojas = [l for l in resp.json() if l.get("access_token")]
    if len(lojas) != 1:
        base.log(f"[ERRO] Esperava 1 loja conectada; achei {len(lojas)}")
        sys.exit(1)
    store, token = int(lojas[0]["store_id"]), lojas[0]["access_token"]
    for pid in ids:
        status, produto = est.nuvemshop("GET", token, f"/{store}/products/{pid}?fields=id,name,brand,categories,published,updated_at")
        base.log(f"=== produto {pid} (HTTP {status})")
        if status != 200:
            base.log(f"    {str(produto)[:400]}")
            continue
        base.log(f"    nome={produto.get('name')!r} published={produto.get('published')} updated_at={produto.get('updated_at')}")
        base.log(f"    brand={json.dumps(produto.get('brand'), ensure_ascii=False)}")
        for c in produto.get("categories") or []:
            nome = (c.get("name") or {}).get("pt") if isinstance(c, dict) else c
            base.log(f"    categoria id={c.get('id') if isinstance(c, dict) else c} nome={nome!r} parent={c.get('parent') if isinstance(c, dict) else None}")
        if not produto.get("categories"):
            base.log("    (sem categorias)")


if __name__ == "__main__":
    main()
