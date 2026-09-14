"""
Bootstrap OAuth 2.0 do Bling API v3 (executar UMA vez, localmente).

Fluxo:
  1. Abre o navegador na tela de autorização do Bling.
  2. Sobe um servidor local em BLING_REDIRECT_URI para capturar o ?code=.
  3. Troca o code por access_token + refresh_token.
  4. Grava os tokens na tabela public.bling_oauth do Supabase (upsert por `conta`).
     Também salva uma cópia em .bling_tokens.json (gitignored) como backup.

Pré-requisitos no .env:
  BLING_CLIENT_ID, BLING_CLIENT_SECRET, BLING_REDIRECT_URI, BLING_CONTA,
  SUPABASE_URL, SUPABASE_SERVICE_KEY

A URL em BLING_REDIRECT_URI precisa estar cadastrada IGUAL no app do Bling.
"""

import base64
import json
import os
import secrets
import sys
import threading
import webbrowser
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlencode, urlparse, parse_qs

import requests
from dotenv import load_dotenv

load_dotenv()

CLIENT_ID = os.getenv("BLING_CLIENT_ID")
CLIENT_SECRET = os.getenv("BLING_CLIENT_SECRET")
REDIRECT_URI = os.getenv("BLING_REDIRECT_URI", "http://localhost:8080/callback")
CONTA = os.getenv("BLING_CONTA", "barbers")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

# URLs conforme components.securitySchemes.OAuth2 no OpenAPI oficial do Bling
# (https://developer.bling.com.br/build/assets/openapi-*.json) — note que o host é
# bling.com.br (sem "www." e sem "api."), diferente do host da API (api.bling.com.br).
AUTHORIZE_URL = "https://bling.com.br/Api/v3/oauth/authorize"
TOKEN_URL = "https://bling.com.br/Api/v3/oauth/token"

_result = {}


class _CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        _result.update({k: v[0] for k, v in params.items()})
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        msg = "Autorizacao recebida. Pode fechar esta aba e voltar ao terminal."
        if "error" in params:
            msg = f"Erro na autorizacao: {params.get('error')}"
        self.wfile.write(f"<html><body><h3>{msg}</h3></body></html>".encode("utf-8"))

    def log_message(self, *args):
        pass


def _exchange_code(code: str) -> dict:
    basic = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
    resp = requests.post(
        TOKEN_URL,
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
        },
        timeout=30,
    )
    if resp.status_code >= 400:
        print(f"[ERRO] Troca de code falhou ({resp.status_code}): {resp.text}")
        sys.exit(1)
    return resp.json()


def _save_supabase(tokens: dict):
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(tokens["expires_in"]))
    row = {
        "conta": CONTA,
        "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
        "expires_at": expires_at.isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(".bling_tokens.json", "w") as f:
        json.dump(row, f, indent=2)
    print("[OK] Backup local salvo em .bling_tokens.json")

    if not (SUPABASE_URL and SUPABASE_SERVICE_KEY):
        print("[AVISO] SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes — pulei o Supabase.")
        return

    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/bling_oauth",
        headers={
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        json=row,
        timeout=30,
    )
    if resp.status_code >= 400:
        print(f"[ERRO] Gravacao no Supabase falhou ({resp.status_code}): {resp.text}")
        print("       Crie a tabela primeiro: sql/create_table_bling_oauth.sql")
        sys.exit(1)
    print(f"[OK] Tokens gravados em public.bling_oauth (conta={CONTA}).")


def main():
    faltando = [k for k, v in {
        "BLING_CLIENT_ID": CLIENT_ID,
        "BLING_CLIENT_SECRET": CLIENT_SECRET,
        "BLING_REDIRECT_URI": REDIRECT_URI,
    }.items() if not v]
    if faltando:
        print(f"[ERRO] Variaveis ausentes no .env: {', '.join(faltando)}")
        sys.exit(1)

    parsed = urlparse(REDIRECT_URI)
    host, port = parsed.hostname or "localhost", parsed.port or 80

    state = secrets.token_urlsafe(16)
    auth_url = AUTHORIZE_URL + "?" + urlencode({
        "response_type": "code",
        "client_id": CLIENT_ID,
        "state": state,
        "redirect_uri": REDIRECT_URI,
    })

    server = HTTPServer((host, port), _CallbackHandler)
    threading.Thread(target=server.handle_request, daemon=True).start()

    print("Abrindo o navegador para autorizar o app no Bling...")
    print(f"Se nao abrir, acesse manualmente:\n{auth_url}\n")
    webbrowser.open(auth_url)

    print(f"Aguardando callback em {REDIRECT_URI} ...")
    server.socket.settimeout(300)
    while "code" not in _result and "error" not in _result:
        threading.Event().wait(0.5)

    if "error" in _result:
        print(f"[ERRO] Autorizacao negada: {_result.get('error')}")
        sys.exit(1)
    if _result.get("state") != state:
        print("[ERRO] state divergente — possivel CSRF. Abortado.")
        sys.exit(1)

    print("[OK] Code recebido. Trocando por tokens...")
    tokens = _exchange_code(_result["code"])
    _save_supabase(tokens)
    print("\nBootstrap concluido. Agora o ETL pode rodar.")


if __name__ == "__main__":
    main()
