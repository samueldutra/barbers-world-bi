"""
Sincroniza a dimensão de canais de venda do Bling (GET /canais-venda). Baixo volume
(dezenas de linhas) — rodar sob demanda, sempre que um canal novo for criado/desativado
no Bling, não precisa de agendamento.

Reaproveita a mesma infraestrutura de sessão/OAuth/retry do
`etl-bling-pedidos-vendas.py` (duplicada aqui de propósito — ver nota em
`sync-clientes-bling.py`).
"""

import os
import json
import re
import boto3
import requests
import time
import traceback
import threading
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from dotenv import load_dotenv
load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_KEY')

LOCAL_MODE = os.getenv('LOCAL_MODE', 'false').lower() == 'true'
LOCAL_CLIENT_CONFIGS = os.getenv('LOCAL_CLIENT_CONFIGS')
LOCAL_BLING_CREDENTIALS = os.getenv('LOCAL_BLING_CREDENTIALS')

ssm_client = None if LOCAL_MODE else boto3.client('ssm')
http_session = None
rpc_semaphore = threading.Semaphore(3)

BLING_BASE_URL = "https://api.bling.com.br/Api/v3"
BLING_TOKEN_URL = "https://bling.com.br/Api/v3/oauth/token"
BLING_MAX_REQ_POR_SEGUNDO = 2.0

# Bling agrupa integrações parecidas sob "tipos" distintos (ex.: várias contas Shopee).
# Isso normaliza pro grupo que o BI usa nos filtros/gráficos por canal.
MAPA_GRUPO = {
    "LojaFisica": "Loja Física (PDV)",
    "Nuvemshop": "Nuvemshop",
    "Shopee": "Shopee",
    "MercadoLivre": "Mercado Livre",
    "TikTok": "TikTok",
    "VendaDireta": "Venda Direta/Atacado",
}


def mapear_grupo(tipo: str) -> str:
    return MAPA_GRUPO.get(tipo, tipo or "Outro")


class RateLimiter:
    def __init__(self, max_por_segundo: float):
        self.min_intervalo = 1.0 / max_por_segundo
        self.lock = threading.Lock()
        self.ultima_chamada = 0.0

    def aguardar(self):
        with self.lock:
            agora = time.time()
            espera = self.ultima_chamada + self.min_intervalo - agora
            if espera > 0:
                time.sleep(espera)
            self.ultima_chamada = time.time()


bling_rate_limiter = RateLimiter(BLING_MAX_REQ_POR_SEGUNDO)

_token_cache: Dict[str, Dict[str, Any]] = {}
_token_cache_lock = threading.Lock()
_token_refresh_locks: Dict[str, threading.Lock] = {}
_token_refresh_locks_lock = threading.Lock()


def _lock_para_conta(conta: str) -> threading.Lock:
    with _token_refresh_locks_lock:
        if conta not in _token_refresh_locks:
            _token_refresh_locks[conta] = threading.Lock()
        return _token_refresh_locks[conta]


def log(mensagem: str):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{timestamp}] {mensagem}")


_TIMESTAMPTZ_RE = re.compile(r'^(.*T\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2}:\d{2}|Z)?$')


def parse_timestamptz(valor: str) -> datetime:
    match = _TIMESTAMPTZ_RE.match(valor.strip())
    if not match:
        return datetime.fromisoformat(valor)
    base, frac, tz = match.groups()
    frac_norm = ('.' + (frac[1:] + '000000')[:6]) if frac else ''
    tz_norm = '+00:00' if (tz in (None, 'Z')) else tz
    return datetime.fromisoformat(base + frac_norm + tz_norm)


def get_http_session() -> requests.Session:
    global http_session
    if http_session is not None:
        return http_session
    session = requests.Session()
    session.headers.update({"Accept-Encoding": "gzip, deflate"})
    retry = Retry(
        total=5, connect=5, read=5, backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["HEAD", "GET", "OPTIONS", "POST", "DELETE"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(pool_connections=20, pool_maxsize=50, max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    http_session = session
    return http_session


def rpc_supabase_com_retry(rpc_name: str, payload: dict, max_retries: int = 3,
                            backoff_factor: float = 1.0, context: str = None):
    context_str = f" [{context}]" if context else ""
    url = f"{SUPABASE_URL}/rest/v1/rpc/{rpc_name}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }
    for attempt in range(max_retries + 1):
        with rpc_semaphore:
            try:
                session = get_http_session()
                response = session.post(url, json=payload, headers=headers, timeout=120)
                if response.status_code >= 400:
                    try:
                        error_detail = response.json()
                        log(f"[ERRO SUPABASE {response.status_code}]{context_str} Detalhes: {json.dumps(error_detail, indent=2)}")
                    except Exception:
                        log(f"[ERRO SUPABASE {response.status_code}]{context_str} Response: {response.text[:500]}")
                response.raise_for_status()
                return response
            except Exception as e:
                if attempt < max_retries:
                    wait_time = backoff_factor * (2 ** attempt)
                    log(f"[RETRY]{context_str} RPC {rpc_name} falhou (tentativa {attempt + 1}/{max_retries + 1}): {e}. Aguardando {wait_time:.1f}s...")
                    time.sleep(wait_time)
                else:
                    log(f"[ERRO]{context_str} RPC {rpc_name} falhou após {max_retries + 1} tentativas: {e}")
                    raise


def obter_configuracoes_clientes() -> dict:
    if LOCAL_MODE:
        if not LOCAL_CLIENT_CONFIGS:
            raise ValueError("LOCAL_CLIENT_CONFIGS não configurado no .env")
        return json.loads(LOCAL_CLIENT_CONFIGS)
    parameter = ssm_client.get_parameter(Name='/etl/bling/client_configs', WithDecryption=True)
    return json.loads(parameter['Parameter']['Value'])


def obter_credenciais_bling(cliente_id: str) -> dict:
    if LOCAL_MODE:
        if LOCAL_BLING_CREDENTIALS:
            return json.loads(LOCAL_BLING_CREDENTIALS)
        return {
            "client_id": os.getenv("BLING_CLIENT_ID"),
            "client_secret": os.getenv("BLING_CLIENT_SECRET"),
            "redirect_uri": os.getenv("BLING_REDIRECT_URI"),
        }
    param_name = f'/etl/bling/{cliente_id}/app'
    parameter = ssm_client.get_parameter(Name=param_name, WithDecryption=True)
    return json.loads(parameter['Parameter']['Value'])


def _bling_oauth_url(conta: str = None) -> str:
    url = f"{SUPABASE_URL}/rest/v1/bling_oauth"
    if conta:
        url += f"?conta=eq.{conta}"
    return url


def _supabase_headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }


def obter_tokens_supabase(conta: str) -> Optional[dict]:
    session = get_http_session()
    resp = session.get(_bling_oauth_url(conta), headers=_supabase_headers(), timeout=30)
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


def salvar_tokens_supabase(conta: str, access_token: str, refresh_token: str, expires_in: int):
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
    row = {
        "conta": conta,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at.isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    session = get_http_session()
    headers = _supabase_headers()
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    resp = session.post(_bling_oauth_url(), headers=headers, json=row, timeout=30)
    resp.raise_for_status()


def renovar_access_token(client_id: str, client_secret: str, refresh_token: str) -> dict:
    import base64
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    session = get_http_session()
    resp = session.post(
        BLING_TOKEN_URL,
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        data={"grant_type": "refresh_token", "refresh_token": refresh_token},
        timeout=30,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Falha ao renovar token Bling ({resp.status_code}): {resp.text[:500]}")
    return resp.json()


def obter_access_token_valido(cliente_id: str, conta: str, forcar_refresh: bool = False) -> str:
    if not forcar_refresh:
        with _token_cache_lock:
            cache = _token_cache.get(conta)
            if cache and cache["expires_at"] > datetime.now(timezone.utc) + timedelta(minutes=5):
                return cache["access_token"]

    with _lock_para_conta(conta):
        if not forcar_refresh:
            with _token_cache_lock:
                cache = _token_cache.get(conta)
                if cache and cache["expires_at"] > datetime.now(timezone.utc) + timedelta(minutes=5):
                    return cache["access_token"]

        row = obter_tokens_supabase(conta)
        if not row:
            raise RuntimeError(
                f"Nenhum token encontrado em public.bling_oauth para conta='{conta}'. "
                f"Rode bling_oauth_bootstrap.py primeiro."
            )

        expires_at = parse_timestamptz(row["expires_at"])
        if not forcar_refresh and expires_at > datetime.now(timezone.utc) + timedelta(minutes=5):
            with _token_cache_lock:
                _token_cache[conta] = {"access_token": row["access_token"], "expires_at": expires_at}
            return row["access_token"]

        log(f"[OAUTH] Token da conta '{conta}' expirando/expirado/inválido — renovando...")
        creds = obter_credenciais_bling(cliente_id)
        tokens = renovar_access_token(creds["client_id"], creds["client_secret"], row["refresh_token"])
        salvar_tokens_supabase(conta, tokens["access_token"], tokens["refresh_token"], tokens["expires_in"])

        nova_expiracao = datetime.now(timezone.utc) + timedelta(seconds=int(tokens["expires_in"]))
        with _token_cache_lock:
            _token_cache[conta] = {"access_token": tokens["access_token"], "expires_at": nova_expiracao}
        log(f"[OAUTH] Token da conta '{conta}' renovado com sucesso.")
        return tokens["access_token"]


def _bling_get(cliente_id: str, conta: str, path: str, params: dict = None) -> dict:
    for tentativa in range(2):
        access_token = obter_access_token_valido(cliente_id, conta, forcar_refresh=(tentativa > 0))
        bling_rate_limiter.aguardar()
        session = get_http_session()
        resp = session.get(
            f"{BLING_BASE_URL}{path}",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            params=params or {},
            timeout=60,
        )
        if resp.status_code == 401 and tentativa == 0:
            log(f"[OAUTH] 401 inesperado em {path} — forçando refresh e tentando de novo.")
            continue
        if resp.status_code >= 400:
            raise RuntimeError(f"Bling GET {path} falhou ({resp.status_code}): {resp.text[:500]}")
        return resp.json()
    raise RuntimeError(f"Bling GET {path} falhou (401) mesmo após renovar o token.")


def listar_canais_venda(cliente_id: str, conta: str) -> List[dict]:
    canais = []
    pagina = 1
    while True:
        data = _bling_get(cliente_id, conta, "/canais-venda", {"pagina": pagina, "limite": 100})
        registros = data.get("data", [])
        if not registros:
            break
        canais.extend(registros)
        if len(registros) < 100:
            break
        pagina += 1
    return canais


def transformar_canal(canal: dict, data_sincronizacao: str) -> dict:
    tipo = canal.get("tipo")
    return {
        "id_loja": canal["id"],
        "descricao": canal.get("descricao"),
        "tipo": tipo,
        "grupo": mapear_grupo(tipo),
        "situacao": canal.get("situacao"),
        "data_sincronizacao": data_sincronizacao,
    }


def executar_sync(cliente_id: str) -> int:
    configs = obter_configuracoes_clientes()
    config_cliente = configs.get(cliente_id)
    if not config_cliente:
        raise ValueError(f"Cliente '{cliente_id}' não encontrado nas configurações")
    schema = config_cliente["schema"]
    conta_bling = config_cliente.get("conta_bling", cliente_id)

    canais = listar_canais_venda(cliente_id, conta_bling)
    log(f"{len(canais)} canal(is) de venda encontrado(s) na API.")
    if not canais:
        return 0

    data_sincronizacao = datetime.now(timezone.utc).isoformat()
    registros = [transformar_canal(c, data_sincronizacao) for c in canais]

    rpc_supabase_com_retry("processar_carga_canais_venda", {"p_data_json": registros, "p_schema_name": schema})
    log(f"Sync concluído: {len(registros)} canal(is) sincronizado(s).")
    return len(registros)


def main():
    log("=" * 60)
    log("SYNC CANAIS DE VENDA (BLING) - EXECUÇÃO LOCAL")
    log("=" * 60)

    cliente_id = os.getenv('ETL_CLIENTE')
    if not cliente_id:
        log("[ERRO] ETL_CLIENTE não definido no .env")
        return

    try:
        executar_sync(cliente_id)
        log("Execução concluída com sucesso!")
    except Exception as e:
        log(f"Execução falhou: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    main()
