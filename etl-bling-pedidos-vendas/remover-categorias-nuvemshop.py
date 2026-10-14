"""
Remove categorias VAZIAS da Nuvemshop (ESCRITA/EXCLUSÃO). Só apaga a categoria que, AO VIVO, (1) existe com o nome esperado, (2) não tem
subcategorias e (3) não tem nenhum produto. Qualquer outra situação pula a categoria sem apagar. Para no primeiro erro.

Entrada (disparo manual do etl-hourly.yml, campo remover_categorias_nuvemshop, com apenas_nuvemshop marcado):
  CATEGORIAS_PLANO = "ID_CATEGORIA:NOME_ESPERADO|ID_CATEGORIA:NOME_ESPERADO|..."
Depois de apagar, relê (tem que dar 404). O espelho em barbers.nuvemshop_categorias se corrige no próximo ETL do catálogo.
"""

import importlib.util
import os
import sys

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
            cid, nome = parte.split(":", 1)
            itens.append((int(cid), nome.strip()))
        except ValueError:
            base.log(f"[ERRO] Item inválido (esperado ID_CATEGORIA:NOME_ESPERADO): '{parte}'")
            sys.exit(1)
    return itens


def nome_pt(categoria: dict) -> str:
    nome = categoria.get("name")
    return (nome.get("pt") if isinstance(nome, dict) else nome) or ""


def main():
    plano = ler_plano(os.getenv("CATEGORIAS_PLANO", "").strip())
    if not plano:
        base.log("[ERRO] CATEGORIAS_PLANO vazio")
        sys.exit(1)
    url = f"{base.SUPABASE_URL}/rest/v1/canais_integracoes?plataforma=eq.nuvemshop&status=eq.conectado&select=store_id,access_token"
    resp = base.get_http_session().get(url, headers=base._supabase_headers(), timeout=30)
    resp.raise_for_status()
    lojas = [l for l in resp.json() if l.get("access_token")]
    if len(lojas) != 1:
        base.log(f"[ERRO] Esperava 1 loja conectada; achei {len(lojas)}")
        sys.exit(1)
    store, token = int(lojas[0]["store_id"]), lojas[0]["access_token"]
    base.log("=" * 60)
    base.log(f"REMOVER CATEGORIAS VAZIAS — EXCLUSÃO | loja {store} | {len(plano)} categoria(s)")
    base.log("=" * 60)

    apagadas = puladas = 0
    for n, (cid, esperado) in enumerate(plano, 1):
        caminho = f"/{store}/categories/{cid}"
        status, cat = est.nuvemshop("GET", token, f"{caminho}?fields=id,name,parent,subcategories")
        if status == 404:
            base.log(f"[{n}/{len(plano)}] categoria {cid} ({esperado!r}): PULADA — não existe mais")
            puladas += 1
            continue
        if status != 200:
            base.log(f"[{n}/{len(plano)}] categoria {cid}: ERRO — GET falhou ({status}): {str(cat)[:200]}")
            sys.exit(2)
        nome = nome_pt(cat)
        if est.norm(nome) != est.norm(esperado):
            base.log(f"[{n}/{len(plano)}] categoria {cid}: PULADA — o nome ao vivo é {nome!r}, esperado {esperado!r}")
            puladas += 1
            continue
        if cat.get("subcategories"):
            base.log(f"[{n}/{len(plano)}] categoria {cid} ({nome!r}): PULADA — tem {len(cat['subcategories'])} subcategoria(s)")
            puladas += 1
            continue
        status, produtos = est.nuvemshop("GET", token, f"/{store}/products?category_id={cid}&per_page=1&fields=id")
        if status == 200 and produtos:
            base.log(f"[{n}/{len(plano)}] categoria {cid} ({nome!r}): PULADA — ainda tem produto(s) (ex.: {produtos[0].get('id')})")
            puladas += 1
            continue
        if status not in (200, 404):
            base.log(f"[{n}/{len(plano)}] categoria {cid}: ERRO — não consegui conferir os produtos ({status}): {str(produtos)[:200]}")
            sys.exit(2)
        status, resposta = est.nuvemshop("DELETE", token, caminho)
        if status >= 400:
            base.log(f"[{n}/{len(plano)}] categoria {cid} ({nome!r}): ERRO — DELETE recusado ({status}): {str(resposta)[:250]}")
            sys.exit(2)
        status, _ = est.nuvemshop("GET", token, caminho)
        if status != 404:
            base.log(f"[{n}/{len(plano)}] categoria {cid} ({nome!r}): ERRO — depois do DELETE o GET devolveu {status} (esperado 404)")
            sys.exit(2)
        base.log(f"[{n}/{len(plano)}] categoria {cid} ({nome!r}; pai {cat.get('parent')}): APAGADA")
        apagadas += 1
    base.log("=" * 60)
    base.log(f"RESUMO: apagadas {apagadas} | puladas {puladas}")


if __name__ == "__main__":
    main()
