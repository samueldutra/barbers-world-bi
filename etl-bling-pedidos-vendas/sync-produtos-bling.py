"""
Sincroniza a dimensão de produtos (Bling) a partir dos pedidos de venda já carregados —
só os `id_produto` que aparecem em `pedidos_vendas` e ainda não têm linha em `produtos`
(ou estão desatualizados há mais de N dias). Habilita ranking por marca/categoria e curva
ABC no BI.

Fluxo:
  1. Busca o catálogo de categorias de produto uma vez (`/categorias/produtos`, poucas
     dezenas/centenas de linhas) pra resolver `categoria_id` -> descrição sem 1 chamada
     extra por produto.
  2. RPC `obter_produtos_pendentes_sync` retorna os IDs a buscar (paginado).
  3. GET /produtos/{id} pra cada um (rate-limited, com renovação de token por request).
  4. Upsert em lotes de 500 via RPC `processar_carga_produtos`.

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
from concurrent.futures import ThreadPoolExecutor, as_completed
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from dotenv import load_dotenv
load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_KEY')
DISCORD_WEBHOOK_URL = os.getenv('DISCORD_WEBHOOK_URL')

LOCAL_MODE = os.getenv('LOCAL_MODE', 'false').lower() == 'true'
LOCAL_CLIENT_CONFIGS = os.getenv('LOCAL_CLIENT_CONFIGS')
LOCAL_BLING_CREDENTIALS = os.getenv('LOCAL_BLING_CREDENTIALS')

ssm_client = None if LOCAL_MODE else boto3.client('ssm')
http_session = None
rpc_semaphore = threading.Semaphore(3)

BLING_BASE_URL = "https://api.bling.com.br/Api/v3"
BLING_TOKEN_URL = "https://bling.com.br/Api/v3/oauth/token"

BLING_MAX_WORKERS = 3
BLING_MAX_REQ_POR_SEGUNDO = 2.0
DIAS_REVALIDAR_PRODUTO = 30       # não rebusca produto sincronizado há menos de N dias
LOTE_PENDENTES_POR_RODADA = 2000  # limite de produtos buscados numa execução
TAMANHO_LOTE_GRAVACAO = 100       # grava no Supabase a cada N produtos buscados (não espera a rodada toda)


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
    print(f"[{timestamp}] {mensagem}", flush=True)


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


def rpc_supabase_leitura(rpc_name: str, payload: dict) -> Any:
    url = f"{SUPABASE_URL}/rest/v1/rpc/{rpc_name}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    session = get_http_session()
    resp = session.post(url, json=payload, headers=headers, timeout=60)
    resp.raise_for_status()
    return resp.json()


class DiscordLogger:
    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url
        if not webhook_url:
            print("AVISO: URL do Discord não configurada.")

    def _send_request(self, payload: dict) -> bool:
        if not self.webhook_url:
            return False
        headers = {"Content-Type": "application/json"}
        for attempt in range(4):
            try:
                session = get_http_session()
                response = session.post(self.webhook_url, json=payload, headers=headers, timeout=10)
                response.raise_for_status()
                return True
            except requests.exceptions.RequestException as e:
                print(f"Erro ao enviar notificação: {e}")
                if attempt < 3:
                    time.sleep(0.5 * (2 ** attempt))
        return False

    def log_execution(self, status: str, cliente: str, info: str, execution_time: float, error_message: str = None):
        color = 3066993 if status.lower() == "sucesso" else 15158332
        fields = [
            {"name": "Cliente", "value": cliente or "N/A", "inline": True},
            {"name": "Status", "value": f"**{status}**", "inline": True},
            {"name": "Resultado", "value": f"```{info}```", "inline": False},
            {"name": "Tempo", "value": f"{execution_time:.2f}s", "inline": False},
        ]
        if error_message:
            error_text = (error_message[:1018] + '...') if len(error_message) > 1024 else error_message
            fields.append({"name": "Erro", "value": f"```\n{error_text}\n```", "inline": False})
        payload = {
            "embeds": [{
                "title": "Relatório de Execução - Sync Produtos (Bling) 📦",
                "color": color,
                "fields": fields,
                "footer": {"text": "Execução Local | sync-produtos-bling"},
                "timestamp": datetime.now(timezone.utc).isoformat()
            }]
        }
        self._send_request(payload)


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


def buscar_categorias_produtos(cliente_id: str, conta: str) -> Dict[int, str]:
    """Catálogo de categorias (poucas dezenas/centenas de linhas) — busca tudo de uma vez
    pra resolver categoria_id -> descrição sem 1 chamada extra por produto."""
    categorias: Dict[int, str] = {}
    pagina = 1
    while True:
        data = _bling_get(cliente_id, conta, "/categorias/produtos", {"pagina": pagina, "limite": 100})
        registros = data.get("data", [])
        if not registros:
            break
        for c in registros:
            categorias[c["id"]] = c.get("descricao")
        if len(registros) < 100:
            break
        pagina += 1
    return categorias


def buscar_produto(cliente_id: str, conta: str, id_produto: int) -> Optional[dict]:
    try:
        data = _bling_get(cliente_id, conta, f"/produtos/{id_produto}")
        return data.get("data")
    except Exception as e:
        log(f"[ERRO] Falha ao buscar produto {id_produto}: {e}")
        return None


def transformar_produto(produto: dict, categorias: Dict[int, str], data_sincronizacao: str) -> dict:
    categoria = produto.get("categoria") or {}
    categoria_id = categoria.get("id") or None
    return {
        "id_produto": produto["id"],
        "codigo": produto.get("codigo"),
        "nome": produto.get("nome"),
        "marca": produto.get("marca"),
        "categoria_id": categoria_id,
        "categoria_descricao": categorias.get(categoria_id) if categoria_id else None,
        "situacao": produto.get("situacao"),
        "imagem_url": produto.get("imagemURL"),
        "preco": produto.get("preco"),
        "data_sincronizacao": data_sincronizacao,
    }


def enviar_em_lotes(registros: List[dict], rpc_name: str, schema: str, tamanho_lote: int = 500):
    for i in range(0, len(registros), tamanho_lote):
        lote = registros[i:i + tamanho_lote]
        rpc_supabase_com_retry(rpc_name, {"p_data_json": lote, "p_schema_name": schema})


def _buscar_uma_rodada_pendentes(schema: str) -> List[int]:
    """O Supabase corta resultado de RPC em ~1000 linhas (db-max-rows do projeto),
    então `obter_produtos_pendentes_sync` nunca devolve tudo de uma vez — por isso
    `executar_sync` chama isso em rodadas, até não sobrar pendente."""
    pendentes = rpc_supabase_leitura("obter_produtos_pendentes_sync", {
        "p_schema_name": schema,
        "p_dias_revalidar": DIAS_REVALIDAR_PRODUTO,
        "p_limite": LOTE_PENDENTES_POR_RODADA,
    })
    return [row["id_produto"] for row in pendentes]


def executar_sync(cliente_id: str) -> int:
    configs = obter_configuracoes_clientes()
    config_cliente = configs.get(cliente_id)
    if not config_cliente:
        raise ValueError(f"Cliente '{cliente_id}' não encontrado nas configurações")
    schema = config_cliente["schema"]
    conta_bling = config_cliente.get("conta_bling", cliente_id)

    log("Buscando catálogo de categorias de produto...")
    categorias = buscar_categorias_produtos(cliente_id, conta_bling)
    log(f"{len(categorias)} categoria(s) encontrada(s).")

    total_sincronizados = 0
    total_falhas = 0
    rodada = 0
    ja_falhou_nesta_execucao = set()  # evita loop infinito num produto com falha permanente

    while True:
        rodada += 1
        ids_pendentes = [i for i in _buscar_uma_rodada_pendentes(schema) if i not in ja_falhou_nesta_execucao]
        if not ids_pendentes:
            break
        log(f"Rodada {rodada}: {len(ids_pendentes)} produto(s) distinto(s) pendente(s) (só quem ainda não tem registro ou está desatualizado há +{DIAS_REVALIDAR_PRODUTO} dias — vendas repetidas do mesmo produto não geram nova busca).")

        data_sincronizacao = datetime.now(timezone.utc).isoformat()
        buffer: List[dict] = []
        gravados_rodada = 0
        falhas = 0
        processados = 0
        contador_lock = threading.Lock()

        with ThreadPoolExecutor(max_workers=BLING_MAX_WORKERS) as executor:
            futures = {
                executor.submit(buscar_produto, cliente_id, conta_bling, id_produto): id_produto
                for id_produto in ids_pendentes
            }
            for future in as_completed(futures):
                produto = future.result()
                with contador_lock:
                    processados += 1
                if not produto:
                    falhas += 1
                    ja_falhou_nesta_execucao.add(futures[future])
                    continue
                buffer.append(transformar_produto(produto, categorias, data_sincronizacao))

                # Grava incrementalmente (não espera a rodada toda) — dá visibilidade e
                # não perde o que já foi buscado se o processo cair no meio da rodada.
                if len(buffer) >= TAMANHO_LOTE_GRAVACAO:
                    enviar_em_lotes(buffer, "processar_carga_produtos", schema)
                    gravados_rodada += len(buffer)
                    log(f"  ... {processados}/{len(ids_pendentes)} buscados, {gravados_rodada} já gravados nesta rodada.")
                    buffer = []

        if buffer:
            enviar_em_lotes(buffer, "processar_carga_produtos", schema)
            gravados_rodada += len(buffer)

        if falhas:
            log(f"  [AVISO] {falhas} produto(s) falharam e ficaram de fora nesta rodada.")

        total_sincronizados += gravados_rodada
        total_falhas += falhas
        log(f"Rodada {rodada} concluída: {gravados_rodada} produto(s) gravado(s)/atualizado(s).")
        # Continua até uma rodada não achar mais pendente — o Supabase corta a resposta
        # da RPC em ~1000 linhas independente do p_limite pedido, então não dá pra
        # confiar em "veio menos que o limite" como sinal de fim.

    if total_falhas:
        log(f"[AVISO] Total de falhas no sync: {total_falhas}.")
    log(f"Sync concluído: {total_sincronizados} produto(s) sincronizado(s) no total.")
    return total_sincronizados


def main():
    log("=" * 60)
    log("SYNC PRODUTOS (BLING) - EXECUÇÃO LOCAL")
    log("=" * 60)

    cliente_id = os.getenv('ETL_CLIENTE')
    if not cliente_id:
        log("[ERRO] ETL_CLIENTE não definido no .env")
        return

    start_time = time.time()
    discord_logger = DiscordLogger(DISCORD_WEBHOOK_URL)
    status = "Sucesso"
    error_info = None
    total = 0

    try:
        total = executar_sync(cliente_id)
    except Exception as e:
        status = "Falha"
        error_info = str(e)
        log(f"ERRO FATAL: {e}")
        traceback.print_exc()
    finally:
        execution_time = time.time() - start_time
        discord_logger.log_execution(
            status=status,
            cliente=cliente_id,
            info=f"Total sincronizado: {total}",
            execution_time=execution_time,
            error_message=error_info,
        )


if __name__ == "__main__":
    main()
