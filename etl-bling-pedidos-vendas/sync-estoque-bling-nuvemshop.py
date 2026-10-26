"""
Estoque Bling -> Nuvemshop. O SALDO DO BLING É A FONTE DA VERDADE; o SKU do Bling é o que pareia produto e variante.

Modo "comparar" (padrão, SOMENTE LEITURA): lê o saldo (GET /estoques/saldos) de cada produto do Bling pareado por SKU idêntico com
uma variante da Nuvemshop, grava os saldos em barbers.estoque_saldos_bling e resume quantos estoques batem e quantos diferem.

Modo "aplicar" (ESCRITA na Nuvemshop, 1 variante por execução — teste): grava o saldo do Bling no estoque de UMA variante
(PUT /products/{id}/variants/{id} só com `stock`), com travas e releitura. Campo do workflow atualizar_estoque_nuvemshop =
"ID_PRODUTO_BLING:ID_VARIANTE_NS:ESTOQUE_ATUAL_NS:SALDO_BLING". REGRA: preços NUNCA mudam; só o estoque da Nuvemshop segue o Bling.

Modo "lote" (ESCRITA na Nuvemshop, ESTOQUE_LOTE = quantas variantes processar): para as variantes pareadas por SKU idêntico, grava na Nuvemshop o
saldo virtual do Bling (negativo vira 0) onde o estoque difere — inclui ZERAR e REABRIR e as variantes sem controle de estoque (decisão do
usuário: o saldo do Bling é a fonte da verdade). Só o campo `stock` é gravado: preço, promoção e SKU nunca. Por variante, AO VIVO: lê o saldo do
Bling e a variante na Nuvemshop; pula se já está igual, se o SKU difere, se tem mais de um local de estoque ou se o saldo é fracionado; relê e
confere (estoque novo; preço, promoção e SKU intactos). Auditoria em barbers.estoque_nuvemshop_alteracoes. 3 erros seguidos interrompem.

Reaproveita a sessão/OAuth de sync-canais-venda-bling.py (duplicação de infraestrutura já é a convenção desta pasta).
Roda pelo disparo manual do etl-hourly.yml (campos comparar_estoque, atualizar_estoque_nuvemshop e atualizar_estoque_lote).
"""

import importlib.util
import json
import os
import sys
import time
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


NUVEMSHOP_API = "https://api.nuvemshop.com.br/v1"
NUVEMSHOP_UA = "Barbers World BI ETL (samueldutra.rp@gmail.com)"


class Abortar(Exception):
    """Trava de segurança: nada foi gravado."""


def token_nuvemshop(store_id: int) -> str:
    url = (f"{base.SUPABASE_URL}/rest/v1/canais_integracoes?{base.filtro_tenant_canais()}plataforma=eq.nuvemshop&status=eq.conectado"
           f"&store_id=eq.{store_id}&select=access_token")
    resp = base.get_http_session().get(url, headers=base._supabase_headers(), timeout=30)
    resp.raise_for_status()
    linhas = resp.json()
    if not linhas or not linhas[0].get("access_token"):
        raise Abortar(f"Loja {store_id} não está conectada em Canais de Venda.")
    return linhas[0]["access_token"]


_ultima_chamada_ns = [0.0]


def nuvemshop(metodo: str, token: str, path: str, corpo: dict = None):
    """Chamada à Nuvemshop com limitador (~1,4 req/s; balde de 40, vaza 2/s) e espera no 429."""
    for tentativa in range(5):
        espera = _ultima_chamada_ns[0] + 0.7 - time.time()
        if espera > 0:
            time.sleep(espera)
        _ultima_chamada_ns[0] = time.time()
        resp = base.get_http_session().request(
            metodo, f"{NUVEMSHOP_API}{path}",
            headers={"Authentication": f"bearer {token}", "User-Agent": NUVEMSHOP_UA, "Accept": "application/json", "Content-Type": "application/json"},
            data=json.dumps(corpo) if corpo is not None else None, timeout=60)
        if resp.status_code == 429:
            time.sleep(min(float(resp.headers.get("x-rate-limit-reset", 2000)) / 1000.0 + 0.5, 20))
            continue
        try:
            return resp.status_code, resp.json()
        except ValueError:
            return resp.status_code, resp.text[:500]
    return 429, "429 repetido"


def norm(sku) -> str:
    return " ".join(str(sku or "").split()).upper()


def aplicar_um(cliente: str, conta: str, schema: str, bruto: str):
    try:
        id_bling, id_variante, atual_ns, saldo_bling = bruto.split(":")
        id_bling, id_variante = int(id_bling), int(id_variante)
        atual_ns, saldo_bling = float(atual_ns), float(saldo_bling)
    except ValueError as e:
        base.log(f"[ERRO] Formato esperado ID_PRODUTO_BLING:ID_VARIANTE_NS:ESTOQUE_ATUAL_NS:SALDO_BLING — recebido '{bruto}' ({e})")
        sys.exit(1)
    base.log("=" * 60)
    base.log(f"ESTOQUE BLING -> NUVEMSHOP — ESCRITA (1 variante) | produto Bling {id_bling} | variante NS {id_variante} | "
             f"estoque atual NS {atual_ns} -> {saldo_bling} (saldo do Bling)")
    base.log("=" * 60)
    try:
        # 1) O par existe (SKU idêntico) e dá o produto/loja da Nuvemshop.
        par = None
        offset = 0
        while par is None:
            pagina = rpc_json("obter_pares_sku_estoque", {"p_schema_name": schema, "p_offset": offset, "p_limite": 1000})
            par = next((p for p in pagina if int(p["id_variante"]) == id_variante), None)
            if len(pagina) < 1000:
                break
            offset += 1000
        if not par or int(par["id_produto_bling"]) != id_bling:
            raise Abortar("A variante não está pareada por SKU com esse produto do Bling.")
        store_id, id_produto_ns = int(par["store_id"]), int(par["id_produto_ns"])
        base.log(f"Par: SKU Bling '{par['codigo_bling']}' = SKU Nuvemshop '{par['sku_ns']}' | produto NS {id_produto_ns} | loja {store_id}")

        # 2) Saldo do Bling agora é o informado.
        virtual, fisico = ler_saldos(cliente, conta, [id_bling]).get(id_bling, (None, None))
        base.log(f"Saldo no Bling agora: virtual {virtual} | físico {fisico}")
        if virtual is None or abs(virtual - saldo_bling) > 0.0005:
            raise Abortar(f"Saldo do Bling ({virtual}) mudou em relação ao informado ({saldo_bling}).")
        if virtual < 0:
            raise Abortar("Saldo negativo no Bling — não grava.")

        # 3) A variante na Nuvemshop está como esperado.
        token = token_nuvemshop(store_id)
        caminho = f"/{store_id}/products/{id_produto_ns}/variants/{id_variante}"
        status, antes = nuvemshop("GET", token, caminho)
        if status != 200:
            raise RuntimeError(f"GET {caminho} falhou ({status}): {str(antes)[:300]}")
        base.log(f"Variante antes: sku={antes.get('sku')!r} stock={antes.get('stock')} price={antes.get('price')} "
                 f"promo={antes.get('promotional_price')} stock_management={antes.get('stock_management')} "
                 f"inventory_levels={json.dumps(antes.get('inventory_levels'))[:300]}")
        if norm(antes.get("sku")) != norm(par["codigo_bling"]):
            raise Abortar("SKU da variante difere do SKU do Bling.")
        if antes.get("stock") is None or abs(float(antes["stock"]) - atual_ns) > 0.0005:
            raise Abortar(f"Estoque atual da Nuvemshop ({antes.get('stock')}) difere do informado ({atual_ns}).")
        niveis = antes.get("inventory_levels") or []
        if len(niveis) > 1:
            raise Abortar(f"A variante tem {len(niveis)} locais de estoque — o formato simples não é seguro; precisa de inventory_levels.")

        # 4) Grava SÓ o estoque.
        corpo = {"stock": int(saldo_bling) if float(saldo_bling).is_integer() else saldo_bling}
        base.log(f">>> PUT {caminho} corpo={json.dumps(corpo)}")
        status, resposta = nuvemshop("PUT", token, caminho, corpo)
        resumo = {k: resposta.get(k) for k in ("sku", "stock", "price", "promotional_price", "stock_management")} if isinstance(resposta, dict) else resposta
        base.log(f"<<< HTTP {status}: {json.dumps(resumo, ensure_ascii=False)[:600]}")
        if status >= 400:
            raise RuntimeError(f"A Nuvemshop recusou a gravação ({status}).")

        # 5) Relê e confere: estoque novo; preço, promoção e SKU intactos.
        status, depois = nuvemshop("GET", token, caminho)
        base.log(f"Variante depois: sku={depois.get('sku')!r} stock={depois.get('stock')} price={depois.get('price')} "
                 f"promo={depois.get('promotional_price')} stock_management={depois.get('stock_management')}")
        estoque_ok = depois.get("stock") is not None and abs(float(depois["stock"]) - saldo_bling) < 0.0005
        preco_ok = depois.get("price") == antes.get("price") and depois.get("promotional_price") == antes.get("promotional_price")
        sku_ok = depois.get("sku") == antes.get("sku")
        virtual_depois, _ = ler_saldos(cliente, conta, [id_bling]).get(id_bling, (None, None))
        base.log(f"Saldo no Bling depois: virtual {virtual_depois} (antes {virtual})")
        base.log(f"CONFERÊNCIA: estoque={'OK' if estoque_ok else 'DIVERGE'} | preço/promoção={'INTACTOS' if preco_ok else 'ALTERADOS'} | "
                 f"SKU={'INTACTO' if sku_ok else 'ALTERADO'} | saldo Bling={'INTACTO' if virtual_depois == virtual else 'ALTERADO'}")
        base.log("RESULTADO: " + ("SUCESSO — estoque da Nuvemshop = saldo do Bling." if (estoque_ok and preco_ok and sku_ok) else "ATENÇÃO — conferir acima."))
        if not (estoque_ok and preco_ok and sku_ok):
            sys.exit(2)
    except Abortar as e:
        base.log(f"ABORTADO SEM GRAVAR: {e}")
        sys.exit(3)


def processar_estoque(cliente, c, token, caminho_base, saldo_vivo):
    """Uma variante. Devolve (resultado, motivo, estoque_anterior, estoque_novo)."""
    id_bling, id_variante, id_produto_ns = int(c["id_produto_bling"]), int(c["id_variante"]), int(c["id_produto_ns"])
    par_saldo = saldo_vivo.get(id_bling)  # (saldo_virtual, saldo_fisico) — ler_saldos devolve o par
    if par_saldo is None:
        return "pulado", "sem saldo de estoque no Bling", None, None
    saldo = par_saldo[0]
    alvo = max(saldo, 0.0)
    if abs(alvo - round(alvo)) > 0.0005:
        return "pulado", f"saldo fracionado no Bling ({saldo})", None, None
    caminho = f"{caminho_base}/{id_produto_ns}/variants/{id_variante}"
    status, antes = nuvemshop("GET", token, caminho)
    if status != 200:
        return "erro", f"GET variante falhou ({status}): {str(antes)[:200]}", None, None
    anterior = None if antes.get("stock") is None else float(antes["stock"])
    if norm(antes.get("sku")) != norm(c["codigo_bling"]):
        return "pulado", f"SKU da variante ({antes.get('sku')}) difere do SKU do Bling ({c['codigo_bling']})", anterior, None
    if len(antes.get("inventory_levels") or []) > 1:
        return "pulado", "mais de um local de estoque na variante", anterior, None
    if anterior is not None and abs(anterior - alvo) < 0.0005:
        return "pulado", "já está igual ao saldo do Bling", anterior, alvo
    status, resposta = nuvemshop("PUT", token, caminho, {"stock": int(round(alvo))})
    if status >= 400:
        return "erro", f"PUT recusado ({status}): {json.dumps(resposta, ensure_ascii=False)[:250]}", anterior, alvo
    status, depois = nuvemshop("GET", token, caminho)
    if status != 200:
        return "erro", f"GET de conferência falhou ({status})", anterior, alvo
    if depois.get("stock") is None or abs(float(depois["stock"]) - alvo) > 0.0005:
        return "erro", f"estoque não ficou como esperado: {depois.get('stock')} (esperado {alvo})", anterior, alvo
    if depois.get("price") != antes.get("price") or depois.get("promotional_price") != antes.get("promotional_price") or depois.get("sku") != antes.get("sku"):
        return "erro", (f"PREÇO/PROMOÇÃO/SKU MUDOU: preço {antes.get('price')}->{depois.get('price')} promo {antes.get('promotional_price')}->"
                        f"{depois.get('promotional_price')} sku {antes.get('sku')!r}->{depois.get('sku')!r}"), anterior, alvo
    return "sucesso", None, anterior, alvo


def aplicar_lote(cliente, conta, schema, limite):
    base.log("=" * 60)
    base.log(f"ESTOQUE BLING -> NUVEMSHOP — LOTE (ESCRITA) | limite {limite} | saldo do Bling é a fonte da verdade (zera e reabre; negativo = 0)")
    base.log("=" * 60)
    candidatos = []
    while True:
        pagina = rpc_json("obter_estoques_a_gravar", {"p_schema_name": schema, "p_offset": len(candidatos), "p_limite": 1000})
        candidatos.extend(pagina)
        if len(pagina) < 1000:
            break
    por_caso = {}
    for c in candidatos:
        por_caso[c["caso"]] = por_caso.get(c["caso"], 0) + 1
    base.log(f"{len(candidatos)} variante(s) com estoque diferente do Bling: {por_caso}; este disparo processa {min(limite, len(candidatos))}.")
    lote = candidatos[:limite]
    if not lote:
        base.log("Nada a fazer.")
        return
    saldos = ler_saldos(cliente, conta, sorted({int(c["id_produto_bling"]) for c in lote}))
    tokens = {}
    contagem, pulados, auditoria, seguidos, inicio = {"sucesso": 0, "pulado": 0, "erro": 0}, {}, [], 0, time.time()

    def gravar_auditoria():
        if auditoria:
            base.rpc_supabase_com_retry("registrar_estoque_nuvemshop_alteracoes", {"p_data_json": list(auditoria), "p_schema_name": schema})
            auditoria.clear()

    try:
        for n, c in enumerate(lote, 1):
            try:
                store = int(c["store_id"])
                if store not in tokens:
                    tokens[store] = token_nuvemshop(store)
                resultado, motivo, anterior, novo = processar_estoque(cliente, c, tokens[store], f"/{store}/products", saldos)
            except Exception as e:  # erro inesperado numa variante não derruba o lote
                resultado, motivo, anterior, novo = "erro", f"exceção: {e}", None, None
            contagem[resultado] += 1
            if resultado == "pulado":
                pulados.setdefault(motivo, []).append(c["sku_ns"])
            seguidos = seguidos + 1 if resultado == "erro" else 0
            base.log(f"[{n}/{len(lote)}] {c['sku_ns']} ({c['caso']}) NS {anterior} -> {novo if novo is not None else c['estoque_alvo']}: "
                     f"{resultado.upper()}{' — ' + motivo if motivo else ''}")
            auditoria.append({"id_variante": int(c["id_variante"]), "id_produto_bling": int(c["id_produto_bling"]), "sku": c["sku_ns"], "caso": c["caso"],
                              "estoque_anterior": anterior, "estoque_novo": novo, "resultado": resultado, "motivo": motivo})
            if len(auditoria) >= 20:
                gravar_auditoria()
            if seguidos >= 3:
                base.log("INTERROMPIDO: 3 erros seguidos.")
                break
    finally:
        gravar_auditoria()
    base.log("=" * 60)
    base.log(f"RESUMO: gravados {contagem['sucesso']} | pulados {contagem['pulado']} | erros {contagem['erro']} | {time.time() - inicio:.0f}s")
    for motivo, skus in pulados.items():
        base.log(f"  pulados ({len(skus)}): {motivo} -> {', '.join(skus[:12])}{' …' if len(skus) > 12 else ''}")
    if contagem["erro"]:
        sys.exit(2)


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

    lote = os.getenv("ESTOQUE_LOTE", "").strip()
    if lote:
        aplicar_lote(cliente, conta, schema, int(lote))
        return

    aplicar = os.getenv("ESTOQUE_APLICAR", "").strip()
    if aplicar:
        aplicar_um(cliente, conta, schema, aplicar)
        return

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
