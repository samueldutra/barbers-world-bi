"""
Estoque Bling -> Nuvemshop. O SALDO DO BLING É A FONTE DA VERDADE; o SKU do Bling é o que pareia produto e variante.

Modo "comparar" (padrão, SOMENTE LEITURA): lê o saldo (GET /estoques/saldos) de cada produto do Bling pareado por SKU idêntico com
uma variante da Nuvemshop, grava os saldos em barbers.estoque_saldos_bling e resume quantos estoques batem e quantos diferem.

Reaproveita a sessão/OAuth de sync-canais-venda-bling.py (duplicação de infraestrutura já é a convenção desta pasta).
Roda pelo disparo manual do etl-hourly.yml (campo comparar_estoque).
"""

import importlib.util
import json
import os
import sys
import traceback
from datetime import datetime, timezone

_spec = importlib.util.spec_from_file_location("sync_canais", os.path.join(os.path.dirname(__file__), "sync-canais-venda-bling.py"))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)

LOTE_SALDOS = 100  # ids por requisição a /estoques/saldos


def rpc_json(nome: str, payload: dict):
    """RPC que devolve corpo (o helper do base usa return=minimal e descarta a resposta)."""
    resp = base.get_http_session().post(f"{base.SUPABASE_URL}/rest/v1/rpc/{nome}", json=payload, headers=base._supabase_headers(), timeout=120)
    resp.raise_for_status()
    return resp.json()


def bling_get(cliente: str, conta: str, path: str, params):
    """GET com params como lista de tuplas (a API repete idsProdutos[]); renova o token em 401."""
    for tentativa in range(2):
        token = base.obter_access_token_valido(cliente, conta, forcar_refresh=(tentativa > 0))
        base.bling_rate_limiter.aguardar()
        resp = base.get_http_session().get(f"{base.BLING_BASE_URL}{path}", headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                                           params=params, timeout=60)
        if resp.status_code == 401 and tentativa == 0:
            continue
        if resp.status_code >= 400:
            raise RuntimeError(f"GET {path} falhou ({resp.status_code}): {resp.text[:400]}")
        return resp.json()
    raise RuntimeError(f"GET {path} falhou (401) mesmo após renovar o token.")


def ler_saldos(cliente: str, conta: str, ids: list) -> dict:
    """{id_produto: (saldo_virtual, saldo_fisico)} dos produtos pedidos."""
    saldos = {}
    for i in range(0, len(ids), LOTE_SALDOS):
        lote = ids[i:i + LOTE_SALDOS]
        corpo = bling_get(cliente, conta, "/estoques/saldos", [("idsProdutos[]", pid) for pid in lote])
        for item in corpo.get("data") or []:
            saldos[int(item["produto"]["id"])] = (float(item.get("saldoVirtualTotal") or 0), float(item.get("saldoFisicoTotal") or 0))
        if (i // LOTE_SALDOS) % 5 == 0:
            base.log(f"  saldos lidos: {len(saldos)} de {len(ids)}")
    return saldos


def main():
    cliente = os.getenv("ETL_CLIENTE")
    if not cliente:
        base.log("[ERRO] ETL_CLIENTE não definido")
        sys.exit(1)
    config = base.obter_configuracoes_clientes().get(cliente)
    if not config:
        base.log(f"[ERRO] Cliente '{cliente}' não encontrado")
        sys.exit(1)
    schema, conta = config["schema"], config.get("conta_bling", cliente)

    base.log("=" * 60)
    base.log("ESTOQUE BLING x NUVEMSHOP — COMPARAÇÃO (somente leitura)")
    base.log("=" * 60)

    pares = []
    while True:  # o Supabase corta RPC em 1000 linhas: pagina até vir menos que o tamanho da página
        pagina = rpc_json("obter_pares_sku_estoque", {"p_schema_name": schema, "p_offset": len(pares), "p_limite": 1000})
        pares.extend(pagina)
        if len(pagina) < 1000:
            break
    ids = sorted({int(p["id_produto_bling"]) for p in pares})
    base.log(f"{len(pares)} variante(s) da Nuvemshop com SKU idêntico ao de {len(ids)} produto(s) do Bling.")

    saldos = ler_saldos(cliente, conta, ids)
    faltando = [i for i in ids if i not in saldos]
    base.log(f"Saldos recebidos: {len(saldos)}; sem saldo na resposta: {len(faltando)}")

    agora = datetime.now(timezone.utc).isoformat()
    registros = [{"id_produto": pid, "saldo_virtual": v, "saldo_fisico": f, "atualizado_em": agora} for pid, (v, f) in saldos.items()]
    for i in range(0, len(registros), 500):
        base.rpc_supabase_com_retry("processar_carga_estoque_saldos_bling", {"p_data_json": registros[i:i + 500], "p_schema_name": schema})

    iguais = maiores_ns = menores_ns = sem_controle = negativos = 0
    amostra = []
    for p in pares:
        bling = saldos.get(int(p["id_produto_bling"]))
        if bling is None:
            continue
        virtual = bling[0]
        ns = p.get("estoque_ns")
        if virtual < 0:
            negativos += 1
        if ns is None:
            sem_controle += 1
        elif abs(float(ns) - virtual) < 0.0005:
            iguais += 1
        else:
            if float(ns) > virtual:
                maiores_ns += 1
            else:
                menores_ns += 1
            if len(amostra) < 12:
                amostra.append((p["sku_ns"], p["estoque_ns"], virtual, bling[1]))
    base.log(f"RESUMO: iguais {iguais} | Nuvemshop MAIOR que o Bling {maiores_ns} | Nuvemshop MENOR que o Bling {menores_ns} | "
             f"Nuvemshop sem controle de estoque {sem_controle} | saldo virtual negativo no Bling {negativos}")
    for sku, ns, virtual, fisico in amostra:
        base.log(f"  ex.: {sku} | Nuvemshop {ns} | Bling virtual {virtual} (físico {fisico})")
    base.log("Comparação concluída. Nada foi gravado na Nuvemshop nem no Bling.")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        base.log(f"Execução falhou: {e}")
        traceback.print_exc()
        sys.exit(1)
