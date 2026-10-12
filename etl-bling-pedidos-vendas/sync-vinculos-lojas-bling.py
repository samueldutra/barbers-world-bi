"""
Sincroniza os vínculos produto x loja virtual do Bling (GET /produtos/lojas) -> barbers.produtos_lojas.

Cada vínculo é o que aparece em Cadastros > Produtos > (produto) > loja: o "ID na loja" (`codigo` — na Nuvemshop é o ID do
PRODUTO na Nuvemshop; "0" = loja marcada mas sem ID) e os preços da loja. SOMENTE LEITURA no Bling (só GET); a escrita
no banco é um upsert em lotes + limpeza do que sumiu (só depois de ler TODAS as páginas).

A listagem sem filtro devolve os vínculos de todas as lojas (o filtro idLojaVirtual é ignorado pela API), então lê tudo
(~100 por página) e a filtragem por loja é feita no banco. Reaproveita a sessão/OAuth de sync-canais-venda-bling.py
(duplicação de infraestrutura já é a convenção desta pasta).
"""

import importlib.util
import os
import sys
import time
import traceback
from datetime import datetime, timezone

_spec = importlib.util.spec_from_file_location("sync_canais", os.path.join(os.path.dirname(__file__), "sync-canais-venda-bling.py"))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)

POR_PAGINA = 100       # máximo da API
MAX_PAGINAS = 600      # trava de segurança contra paginação que não termina


def listar_vinculos(cliente: str, conta: str) -> list:
    vinculos, vistos, pagina = [], set(), 1
    while pagina <= MAX_PAGINAS:
        corpo = base._bling_get(cliente, conta, "/produtos/lojas", {"pagina": pagina, "limite": POR_PAGINA})
        itens = corpo.get("data") or []
        if not itens:
            break
        novos = [v for v in itens if v.get("id") not in vistos]
        if not novos:
            # A API devolveu uma página já vista: paginação ignorada — para em vez de repetir pra sempre.
            base.log(f"  [AVISO] página {pagina} sem vínculos novos; encerrando a leitura.")
            break
        vistos.update(v["id"] for v in novos)
        vinculos.extend(novos)
        if pagina % 10 == 0 or len(itens) < POR_PAGINA:
            base.log(f"  página {pagina}: acumulado {len(vinculos)} vínculo(s)")
        if len(itens) < POR_PAGINA:
            break
        pagina += 1
    else:
        raise RuntimeError(f"Mais de {MAX_PAGINAS} páginas de vínculos — abortado (leitura incompleta).")
    return vinculos


def _num(valor):
    try:
        return None if valor in (None, "") else float(valor)
    except (TypeError, ValueError):
        return None


def transformar(v: dict, data_sincronizacao: str) -> dict:
    return {
        "id_vinculo": int(v["id"]),
        "id_produto": int((v.get("produto") or {}).get("id")),
        "id_loja": int((v.get("loja") or {}).get("id")),
        "codigo": (str(v["codigo"])[:200] if v.get("codigo") is not None else None),
        "preco": _num(v.get("preco")),
        "preco_promocional": _num(v.get("precoPromocional")),
        "id_fornecedor_loja": (v.get("fornecedorLoja") or {}).get("id"),
        "id_marca_loja": (v.get("marcaLoja") or {}).get("id"),
        "qtd_categorias": len(v.get("categoriasProdutos") or []),
        "data_sincronizacao": data_sincronizacao,
    }


def main():
    cliente = os.getenv("ETL_CLIENTE")
    if not cliente:
        base.log("[ERRO] ETL_CLIENTE não definido")
        sys.exit(1)
    configs = base.obter_configuracoes_clientes()
    config = configs.get(cliente)
    if not config:
        base.log(f"[ERRO] Cliente '{cliente}' não encontrado nas configurações")
        sys.exit(1)
    schema = config["schema"]
    conta = config.get("conta_bling", cliente)

    base.log("=" * 60)
    base.log("SYNC VÍNCULOS PRODUTO x LOJA (BLING) — somente leitura no Bling")
    base.log("=" * 60)
    inicio = time.time()
    data_sincronizacao = datetime.now(timezone.utc).isoformat()

    vinculos = listar_vinculos(cliente, conta)
    base.log(f"{len(vinculos)} vínculo(s) lido(s) em {time.time() - inicio:.0f}s.")
    if not vinculos:
        base.log("Nenhum vínculo retornado — nada a gravar (e nada é removido).")
        return

    registros = {}
    for v in vinculos:
        try:
            r = transformar(v, data_sincronizacao)
            registros[r["id_vinculo"]] = r
        except (KeyError, TypeError, ValueError) as e:
            base.log(f"  [AVISO] vínculo ignorado ({e}): {str(v)[:200]}")
    lista = list(registros.values())

    for i in range(0, len(lista), 500):
        base.rpc_supabase_com_retry("processar_carga_produtos_lojas",
                                    {"p_data_json": lista[i:i + 500], "p_schema_name": schema})
    # Leitura completa + carga completa: o que não foi tocado nesta execução foi removido no Bling.
    base.rpc_supabase_com_retry("limpar_produtos_lojas_removidos", {"p_schema_name": schema, "p_antes_de": data_sincronizacao})
    base.log(f"Sync concluído: {len(lista)} vínculo(s) gravado(s) em {time.time() - inicio:.0f}s.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        base.log(f"Execução falhou: {e}")
        traceback.print_exc()
        sys.exit(1)
