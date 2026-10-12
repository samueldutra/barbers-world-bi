"""
EXPLORAÇÃO (somente leitura) do vínculo produto x loja virtual do Bling — o campo "ID na loja" que aparece em
Cadastros > Produtos > (produto) > loja > "ver mais". Só faz GET; não altera nada no Bling.

Objetivo: descobrir o contrato real da API (nome do endpoint e dos campos, se lista por loja, o que o Bling devolve
quando o produto não está vinculado) antes de qualquer escrita. Roda pelo workflow etl-hourly.yml (disparo manual,
campo "explorar_vinculos_lojas" = ids de produto do Bling separados por vírgula) e imprime as respostas no log.

Reaproveita a sessão/OAuth de sync-canais-venda-bling.py (duplicação de infraestrutura já é a convenção desta pasta).
"""

import importlib.util
import json
import os
import sys
import traceback

_spec = importlib.util.spec_from_file_location("sync_canais", os.path.join(os.path.dirname(__file__), "sync-canais-venda-bling.py"))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)

LOJA_PADRAO = os.getenv("EXPLORAR_LOJA", "206304549")  # NUVEMSHOP BARBERS WORLD (barbers.canais_venda.id_loja)
LIMITE_LOG = 3000


def sondar(cliente: str, conta: str, titulo: str, path: str, params: dict = None):
    base.log(f"--- {titulo}: GET {path} {params or ''}")
    try:
        corpo = base._bling_get(cliente, conta, path, params)
        texto = json.dumps(corpo, ensure_ascii=False)
        base.log(f"    OK ({len(texto)} bytes): {texto[:LIMITE_LOG]}{' …(cortado)' if len(texto) > LIMITE_LOG else ''}")
    except Exception as e:  # o _bling_get já inclui status e corpo da resposta na mensagem
        base.log(f"    ERRO: {str(e)[:LIMITE_LOG]}")


def main():
    cliente = os.getenv("ETL_CLIENTE")
    ids = [i.strip() for i in os.getenv("EXPLORAR_IDS", "").split(",") if i.strip()]
    if not cliente or not ids:
        base.log("[ERRO] ETL_CLIENTE e EXPLORAR_IDS são obrigatórios")
        sys.exit(1)
    configs = base.obter_configuracoes_clientes()
    conta = configs.get(cliente, {}).get("conta_bling", cliente)

    base.log("=" * 60)
    base.log(f"EXPLORAR VÍNCULOS PRODUTO x LOJA (BLING) — somente leitura | loja {LOJA_PADRAO} | produtos {ids}")
    base.log("=" * 60)

    sondar(cliente, conta, "lista geral de vínculos", "/produtos/lojas", {"limite": 5})
    sondar(cliente, conta, "vínculos da loja", "/produtos/lojas", {"idLojaVirtual": LOJA_PADRAO, "limite": 5})
    for pid in ids:
        sondar(cliente, conta, f"produto {pid}: vínculos", "/produtos/lojas", {"idProduto": pid})
        sondar(cliente, conta, f"produto {pid}: vínculos nesta loja", "/produtos/lojas", {"idProduto": pid, "idLojaVirtual": LOJA_PADRAO})
        sondar(cliente, conta, f"produto {pid}: sub-recurso", f"/produtos/{pid}/lojas")
    # Cadastro do produto: só pra ver se traz algo de loja e conferir preço/estoque de referência.
    sondar(cliente, conta, f"produto {ids[0]}: cadastro", f"/produtos/{ids[0]}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        base.log(f"Execução falhou: {e}")
        traceback.print_exc()
        sys.exit(1)
