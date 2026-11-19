"""Envia os produtos relacionados (complementares) das máquinas de corte para a Nuvemshop.

Fonte: view barbers.v_nuvemshop_relacionados_fila (exclui produtos em barbers.nuvemshop_relacionados_exclusoes).
Cada envio é gravado em barbers.nuvemshop_relacionados_envios (a API da Nuvemshop não permite ler as relações).
Pares já enviados com sucesso são pulados.

Uso (padrão = DRY-RUN, não escreve nada):
    export SUPABASE_URL=... SUPABASE_SERVICE_KEY=... NUVEMSHOP_TOKEN=... NUVEMSHOP_STORE_ID=5475595
    python enviar_relacionados.py                      # mostra o que seria enviado
    python enviar_relacionados.py --apply --limite 3   # envia 3 produtos
    python enviar_relacionados.py --apply              # envia tudo

API: PATCH https://api.nuvemshop.com.br/unstable/{loja}/catalog/product/{id}
     {"complementary_products": [{"id": N, "order": 1}, ...]}  (aditivo; experimental)
"""
import argparse
import os
import sys
import time
from collections import defaultdict
from datetime import datetime

import requests

SB = os.environ.get("SUPABASE_URL", "").rstrip("/")
SB_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
TOKEN = os.environ.get("NUVEMSHOP_TOKEN", "")
LOJA = os.environ.get("NUVEMSHOP_STORE_ID", "5475595")
API = f"https://api.nuvemshop.com.br/unstable/{LOJA}/catalog/product"


def log(msg):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def sb_headers(escrita=False):
    h = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", "Accept-Profile": "barbers"}
    if escrita:
        h.update({"Content-Profile": "barbers", "Content-Type": "application/json", "Prefer": "return=minimal"})
    return h


def sb_get(tabela):
    out, ini = [], 0
    while True:
        r = requests.get(f"{SB}/rest/v1/{tabela}", headers={**sb_headers(), "Range": f"{ini}-{ini + 999}"}, timeout=60)
        r.raise_for_status()
        lote = r.json()
        out += lote
        if len(lote) < 1000:
            return out
        ini += 1000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="envia de verdade (sem isso é dry-run)")
    ap.add_argument("--limite", type=int, default=0, help="máx. de produtos a enviar")
    a = ap.parse_args()
    if not (SB and SB_KEY) or (a.apply and not TOKEN):
        sys.exit("Faltam variáveis: SUPABASE_URL, SUPABASE_SERVICE_KEY e (com --apply) NUVEMSHOP_TOKEN.")

    fila = sb_get("v_nuvemshop_relacionados_fila")
    feitos = {(e["id_produto_nuvem"], e["id_relacionado_nuvem"]) for e in sb_get("nuvemshop_relacionados_envios")
              if e["status"] == "enviado" and e["acao"] == "upsert"}
    por_prod = defaultdict(list)
    for f in fila:
        if (f["id_produto_nuvem"], f["id_relacionado_nuvem"]) not in feitos:
            por_prod[f["id_produto_nuvem"]].append(f)
    prods = list(por_prod.items())
    if a.limite:
        prods = prods[: a.limite]
    log(f"{len(fila)} pares na fila, {sum(len(v) for v in por_prod.values())} pendentes em {len(por_prod)} produtos; "
        f"{'ENVIANDO' if a.apply else 'DRY-RUN'} {len(prods)} produtos")

    lote_id = datetime.now().strftime("lote-%Y%m%d-%H%M%S")
    sess = requests.Session()
    for pid, itens in prods:
        itens.sort(key=lambda x: x["ordem"])
        corpo = {"complementary_products": [{"id": i["id_relacionado_nuvem"], "order": i["ordem"]} for i in itens]}
        if not a.apply:
            log(f"{pid} {itens[0]['codigo']}: " + ", ".join(i["codigo_relacionado"] for i in itens))
            continue
        for tentativa in range(4):
            r = sess.patch(f"{API}/{pid}", json=corpo, timeout=60, headers={
                "Authentication": f"bearer {TOKEN}", "User-Agent": "BI Barbers World"})
            if r.status_code == 429:
                time.sleep(2 + tentativa * 2)
                continue
            break
        ok = r.status_code == 200
        log(f"{pid} {itens[0]['codigo']}: HTTP {r.status_code}")
        reg = [{"id_produto_nuvem": pid, "id_relacionado_nuvem": i["id_relacionado_nuvem"], "ordem": i["ordem"],
                "status": "enviado" if ok else "erro", "http_status": r.status_code,
                "resposta": None if ok else r.text[:500], "lote": lote_id} for i in itens]
        requests.post(f"{SB}/rest/v1/nuvemshop_relacionados_envios", headers=sb_headers(True), json=reg, timeout=60).raise_for_status()
        if not ok:
            log("Erro na API; interrompendo para investigar.")
            break
        time.sleep(0.6)  # limite: 2 req/s por loja


if __name__ == "__main__":
    main()
