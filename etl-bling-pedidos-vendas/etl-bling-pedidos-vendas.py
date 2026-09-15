"""
ETL: Pedidos de Venda do Bling (API v3) -> Supabase.

Fluxo:
  1. Garante um access_token válido (lê/renova/regrava em public.bling_oauth).
  2. Lista IDs de pedidos por período via GET /pedidos/vendas (paginado).
  3. Busca o detalhe de cada pedido via GET /pedidos/vendas/{id} (itens + parcelas).
  4. Transforma: denormaliza cabeçalho+item (1 linha por item) e separa as parcelas.
  5. Carrega via RPC de upsert (lotes de 500) no schema do tenant.
  6. Notifica o resultado no Discord.

Referência de campos: OpenAPI oficial do Bling
(https://developer.bling.com.br/build/assets/openapi-*.json), schemas VendasDadosBaseDTO /
VendasDadosDTO / VendasItemDTO / VendasParcelaDTO.
"""

import os
import sys
import json
import re
import boto3
import requests
import time
import traceback
import threading
from datetime import date, datetime, timedelta, timezone
from typing import List, Dict, Any, Optional
from calendar import monthrange
from concurrent.futures import ThreadPoolExecutor, as_completed
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from dotenv import load_dotenv
load_dotenv()

# --- CONFIGURAÇÃO ---
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_KEY')
DISCORD_WEBHOOK_URL = os.getenv('DISCORD_WEBHOOK_URL')

LOCAL_MODE = os.getenv('LOCAL_MODE', 'false').lower() == 'true'
LOCAL_CLIENT_CONFIGS = os.getenv('LOCAL_CLIENT_CONFIGS')
LOCAL_BLING_CREDENTIALS = os.getenv('LOCAL_BLING_CREDENTIALS')  # opcional; senão usa BLING_CLIENT_ID/SECRET/REDIRECT_URI

ssm_client = None if LOCAL_MODE else boto3.client('ssm')
http_session = None
rpc_semaphore = threading.Semaphore(3)

BLING_BASE_URL = "https://api.bling.com.br/Api/v3"
BLING_TOKEN_URL = "https://bling.com.br/Api/v3/oauth/token"

# Rate limit documentado pelo Bling: 3 req/s. Usamos 2 req/s (margem de segurança) e
# paralelizamos as buscas de detalhe com poucos workers via um limitador de taxa global.
BLING_ITENS_POR_PAGINA = 100
BLING_MAX_WORKERS_DETALHE = 3
BLING_MAX_REQ_POR_SEGUNDO = 2.0


class RateLimiter:
    """Limitador de taxa global (thread-safe) por intervalo mínimo entre chamadas."""

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

# Cache em memória do access_token por conta (evita ida ao Supabase a cada requisição)
_token_cache: Dict[str, Dict[str, Any]] = {}
_token_cache_lock = threading.Lock()
# Um lock por conta pra garantir que só uma thread por vez renove o token (o refresh_token
# do Bling é de uso único — duas renovações concorrentes com o mesmo refresh_token
# derrubariam uma das duas threads com erro).
_token_refresh_locks: Dict[str, threading.Lock] = {}
_token_refresh_locks_lock = threading.Lock()


def _lock_para_conta(conta: str) -> threading.Lock:
    with _token_refresh_locks_lock:
        if conta not in _token_refresh_locks:
            _token_refresh_locks[conta] = threading.Lock()
        return _token_refresh_locks[conta]


# --- FUNÇÕES AUXILIARES ---

def log(mensagem: str):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{timestamp}] {mensagem}")


_TIMESTAMPTZ_RE = re.compile(r'^(.*T\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2}:\d{2}|Z)?$')


def parse_timestamptz(valor: str) -> datetime:
    """Parser tolerante para timestamptz do Postgres/PostgREST.

    Python 3.9 (`datetime.fromisoformat`) só aceita frações de segundo com 3 ou 6
    dígitos, mas o PostgREST devolve precisão variável (ex.: `.67118`, 5 dígitos) —
    normaliza para 6 dígitos antes de parsear.
    """
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
        total=5,
        connect=5,
        read=5,
        backoff_factor=0.5,
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


def dividir_periodo_em_meses(data_inicial: date, data_final: date) -> List[tuple]:
    """Divide o período em blocos mensais (facilita checkpoint/retomada em backfills longos)."""
    meses = []
    atual = data_inicial
    while atual <= data_final:
        _, ultimo_dia = monthrange(atual.year, atual.month)
        fim_mes = date(atual.year, atual.month, ultimo_dia)
        fim_bloco = min(fim_mes, data_final)
        meses.append((atual, fim_bloco))
        if atual.month == 12:
            atual = date(atual.year + 1, 1, 1)
        else:
            atual = date(atual.year, atual.month + 1, 1)
    return meses


class DiscordLogger:
    def __init__(self, webhook_url: str):
        if not webhook_url:
            print("AVISO: URL do Discord não configurada.")
            self.webhook_url = None
            return
        self.webhook_url = webhook_url

    def _send_request(self, payload: dict) -> bool:
        if not self.webhook_url:
            return False
        headers = {"Content-Type": "application/json"}
        max_retries = 3
        for attempt in range(max_retries + 1):
            try:
                session = get_http_session()
                response = session.post(self.webhook_url, json=payload, headers=headers, timeout=10)
                response.raise_for_status()
                return True
            except requests.exceptions.RequestException as e:
                print(f"Erro ao enviar notificação: {e}")
                if attempt < max_retries:
                    time.sleep(0.5 * (2 ** attempt))
        return False

    def log_execution(self, status: str, context, cliente: str, periodo: str,
                       info: str, execution_time: float, error_message: str = None):
        color = 3066993 if status.lower() == "sucesso" else 15158332
        fields = [
            {"name": "Cliente", "value": cliente or "N/A", "inline": True},
            {"name": "Status", "value": f"**{status}**", "inline": True},
            {"name": "Período", "value": periodo, "inline": False},
            {"name": "Registros", "value": f"```{info}```", "inline": False},
            {"name": "Tempo", "value": f"{execution_time:.2f}s", "inline": False}
        ]
        if error_message:
            error_text = (error_message[:1024 - 6] + '...') if len(error_message) > 1024 else error_message
            fields.append({"name": "Erro", "value": f"```\n{error_text}\n```", "inline": False})

        if context and hasattr(context, 'function_name'):
            footer_text = f"Function: {context.function_name} | Request ID: {context.aws_request_id}"
        else:
            footer_text = "Execução Local | etl-bling-pedidos-vendas"

        payload = {
            "embeds": [{
                "title": "Relatório de Execução ETL - Pedidos de Venda (Bling) 🛒",
                "color": color,
                "fields": fields,
                "footer": {"text": footer_text},
                "timestamp": datetime.now(timezone.utc).isoformat()
            }]
        }
        self._send_request(payload)


# --- CONFIGURAÇÕES DE CLIENTE / CREDENCIAIS ---

def obter_configuracoes_clientes() -> dict:
    if LOCAL_MODE:
        if not LOCAL_CLIENT_CONFIGS:
            raise ValueError("LOCAL_CLIENT_CONFIGS não configurado no .env")
        return json.loads(LOCAL_CLIENT_CONFIGS)
    parameter = ssm_client.get_parameter(Name='/etl/bling/client_configs', WithDecryption=True)
    return json.loads(parameter['Parameter']['Value'])


def obter_credenciais_bling(cliente_id: str) -> dict:
    """client_id / client_secret / redirect_uri do app Bling (não são os tokens)."""
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


# --- OAUTH BLING (tokens persistidos em public.bling_oauth) ---

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
    return row


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
    """Retorna um access_token válido, renovando (e persistindo) se necessário.

    Chamada a cada requisição individual (não só uma vez por lote/bloco): um backfill
    pode levar horas pra esvaziar a fila de um bloco grande, e o access_token do Bling
    dura só ~6h — validar a cada request evita usar um token capturado no início do
    bloco e já expirado na hora em que a requisição de fato sai.
    """
    if not forcar_refresh:
        with _token_cache_lock:
            cache = _token_cache.get(conta)
            if cache and cache["expires_at"] > datetime.now(timezone.utc) + timedelta(minutes=5):
                return cache["access_token"]

    # Só uma thread por vez renova (refresh_token é de uso único no Bling).
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


# --- EXTRAÇÃO BLING ---

def _bling_get(cliente_id: str, conta: str, path: str, params: dict = None) -> dict:
    """GET autenticado no Bling. Resolve o token a cada chamada (não recebe um token
    pronto) e, se ainda assim tomar 401 (relógio, revogação, corrida), força um refresh
    e tenta mais uma vez."""
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


def listar_ids_pedidos(cliente_id: str, conta: str, data_inicial: date, data_final: date) -> List[int]:
    ids = []
    pagina = 1
    while True:
        data = _bling_get(cliente_id, conta, "/pedidos/vendas", {
            "pagina": pagina,
            "limite": BLING_ITENS_POR_PAGINA,
            "dataInicial": data_inicial.isoformat(),
            "dataFinal": data_final.isoformat(),
        })
        registros = data.get("data", [])
        if not registros:
            break
        ids.extend(r["id"] for r in registros)
        if len(registros) < BLING_ITENS_POR_PAGINA:
            break
        pagina += 1
    return ids


def buscar_detalhe_pedido(cliente_id: str, conta: str, id_pedido: int) -> Optional[dict]:
    try:
        data = _bling_get(cliente_id, conta, f"/pedidos/vendas/{id_pedido}")
        return data.get("data")
    except Exception as e:
        log(f"[ERRO] Falha ao buscar pedido {id_pedido}: {e}")
        return None


def sanitizar_data(valor):
    """Bling às vezes devolve '0000-00-00' (ou string vazia) pra datas não aplicáveis
    (ex.: dataSaida de um pedido ainda não expedido) — Postgres rejeita isso como DATE."""
    if not valor or valor == "0000-00-00":
        return None
    return valor


def transformar_pedido(pedido: dict, data_extracao: str) -> tuple:
    """Retorna (linhas_itens, linhas_parcelas) a partir do detalhe de 1 pedido."""
    contato = pedido.get("contato") or {}
    situacao = pedido.get("situacao") or {}
    loja = pedido.get("loja") or {}
    vendedor = pedido.get("vendedor") or {}
    categoria = pedido.get("categoria") or {}
    desconto = pedido.get("desconto") or {}
    transporte = pedido.get("transporte") or {}

    base = {
        "id_pedido": pedido["id"],
        "numero": pedido.get("numero"),
        "numero_loja": pedido.get("numeroLoja"),
        "data": sanitizar_data(pedido.get("data")),
        "data_saida": sanitizar_data(pedido.get("dataSaida")),
        "data_prevista": sanitizar_data(pedido.get("dataPrevista")),
        "total_produtos": pedido.get("totalProdutos"),
        "total": pedido.get("total"),
        "id_contato": contato.get("id"),
        "nome_contato": contato.get("nome"),
        "tipo_pessoa_contato": contato.get("tipoPessoa"),
        "documento_contato": contato.get("numeroDocumento"),
        "id_situacao": situacao.get("id"),
        "valor_situacao": situacao.get("valor"),
        "id_loja": loja.get("id"),
        "id_vendedor": vendedor.get("id"),
        "id_categoria": categoria.get("id"),
        "desconto_valor": desconto.get("valor"),
        "desconto_unidade": desconto.get("unidade"),
        "outras_despesas": pedido.get("outrasDespesas"),
        "numero_pedido_compra": pedido.get("numeroPedidoCompra"),
        "observacoes": pedido.get("observacoes"),
        "observacoes_internas": pedido.get("observacoesInternas"),
        "frete_por_conta": transporte.get("fretePorConta"),
        "valor_frete": transporte.get("frete"),
        "quantidade_volumes": transporte.get("quantidadeVolumes"),
        "peso_bruto": transporte.get("pesoBruto"),
        "prazo_entrega": transporte.get("prazoEntrega"),
        "data_extracao": data_extracao,
    }

    linhas_itens = []
    for item in pedido.get("itens") or []:
        produto = item.get("produto") or {}
        linha = dict(base)
        linha.update({
            "id_item": item["id"],
            "codigo_item": item.get("codigo"),
            "descricao_item": item.get("descricao"),
            "descricao_detalhada_item": item.get("descricaoDetalhada"),
            "unidade_item": item.get("unidade"),
            "quantidade_item": item.get("quantidade"),
            "valor_unitario_item": item.get("valor"),
            "desconto_item_percentual": item.get("desconto"),
            "id_produto": produto.get("id"),
        })
        linhas_itens.append(linha)

    linhas_parcelas = []
    for parcela in pedido.get("parcelas") or []:
        forma_pagamento = parcela.get("formaPagamento") or {}
        linhas_parcelas.append({
            "id_pedido": pedido["id"],
            "id_parcela": parcela["id"],
            "data_vencimento": sanitizar_data(parcela.get("dataVencimento")),
            "valor": parcela.get("valor"),
            "observacoes": parcela.get("observacoes"),
            "id_forma_pagamento": forma_pagamento.get("id"),
            "data_extracao": data_extracao,
        })

    return linhas_itens, linhas_parcelas


def remover_duplicatas(registros: List[dict], chave: tuple) -> List[dict]:
    vistos = {}
    for r in registros:
        k = tuple(r[c] for c in chave)
        vistos[k] = r
    return list(vistos.values())


def enviar_em_lotes(registros: List[dict], rpc_name: str, schema: str, tamanho_lote: int = 500, context: str = None):
    for i in range(0, len(registros), tamanho_lote):
        lote = registros[i:i + tamanho_lote]
        rpc_supabase_com_retry(rpc_name, {"p_data_json": lote, "p_schema_name": schema}, context=context)


# --- ORQUESTRAÇÃO ---

def executar_etl(cliente_id: str, data_inicial_str: str, data_final_str: str) -> int:
    configs = obter_configuracoes_clientes()
    config_cliente = configs.get(cliente_id)
    if not config_cliente:
        raise ValueError(f"Cliente '{cliente_id}' não encontrado nas configurações")
    schema = config_cliente["schema"]
    conta_bling = config_cliente.get("conta_bling", cliente_id)

    data_inicial = date.fromisoformat(data_inicial_str)
    data_final = date.fromisoformat(data_final_str)
    blocos = dividir_periodo_em_meses(data_inicial, data_final)

    total_itens = 0
    total_parcelas = 0

    for bloco_inicio, bloco_fim in blocos:
        log(f"Processando bloco {bloco_inicio} a {bloco_fim}...")

        ids_pedidos = listar_ids_pedidos(cliente_id, conta_bling, bloco_inicio, bloco_fim)
        log(f"  {len(ids_pedidos)} pedido(s) encontrado(s) no bloco.")
        if not ids_pedidos:
            continue

        data_extracao = date.today().isoformat()
        itens_bloco: List[dict] = []
        parcelas_bloco: List[dict] = []
        falhas_bloco = 0

        with ThreadPoolExecutor(max_workers=BLING_MAX_WORKERS_DETALHE) as executor:
            futures = {
                executor.submit(buscar_detalhe_pedido, cliente_id, conta_bling, id_pedido): id_pedido
                for id_pedido in ids_pedidos
            }
            for future in as_completed(futures):
                pedido = future.result()
                if not pedido:
                    falhas_bloco += 1
                    continue
                linhas_itens, linhas_parcelas = transformar_pedido(pedido, data_extracao)
                itens_bloco.extend(linhas_itens)
                parcelas_bloco.extend(linhas_parcelas)

        if falhas_bloco:
            log(f"  [AVISO] {falhas_bloco} pedido(s) do bloco falharam e ficaram de fora (ver logs de ERRO acima).")

        itens_bloco = remover_duplicatas(itens_bloco, ("id_pedido", "id_item"))
        parcelas_bloco = remover_duplicatas(parcelas_bloco, ("id_pedido", "id_parcela"))

        contexto = f"{bloco_inicio} a {bloco_fim}"
        if itens_bloco:
            enviar_em_lotes(itens_bloco, "processar_carga_pedidos_vendas", schema, context=contexto)
        if parcelas_bloco:
            enviar_em_lotes(parcelas_bloco, "processar_carga_pedidos_vendas_parcelas", schema, context=contexto)

        total_itens += len(itens_bloco)
        total_parcelas += len(parcelas_bloco)
        log(f"  Bloco concluído: {len(itens_bloco)} itens, {len(parcelas_bloco)} parcelas.")

    log(f"ETL concluído: {total_itens} itens de pedido, {total_parcelas} parcelas.")
    return total_itens


def lambda_handler(event, context):
    start_time = time.time()
    discord_logger = DiscordLogger(DISCORD_WEBHOOK_URL)

    cliente_id = event.get('cliente')
    data_inicial_str = event.get('data_inicial')
    data_final_str = event.get('data_final')

    if cliente_id and not any([data_inicial_str, data_final_str]):
        hoje = date.today()
        data_inicial_str = (hoje - timedelta(days=5)).isoformat()
        data_final_str = hoje.isoformat()
        log(f"Período automático: {data_inicial_str} a {data_final_str}")

    if data_inicial_str and data_final_str:
        periodo = f"De {data_inicial_str} a {data_final_str}"
    else:
        periodo = f"Dia Anterior ({(date.today() - timedelta(days=1)).isoformat()})"

    status = "Sucesso"
    error_info = None
    total_registros = 0

    try:
        total_registros = executar_etl(
            cliente_id=cliente_id,
            data_inicial_str=data_inicial_str,
            data_final_str=data_final_str,
        )
    except Exception as e:
        status = "Falha"
        error_info = str(e)
        log(f"ERRO FATAL: {e}")
        raise
    finally:
        execution_time = time.time() - start_time
        discord_logger.log_execution(
            status=status,
            context=context,
            cliente=cliente_id,
            periodo=periodo,
            info=f"Total itens: {total_registros}",
            execution_time=execution_time,
            error_message=error_info
        )


def main():
    log("=" * 60)
    log("ETL BLING PEDIDOS DE VENDA - EXECUÇÃO LOCAL")
    log("=" * 60)

    cliente_id = os.getenv('ETL_CLIENTE')
    data_inicial = os.getenv('ETL_DATA_INICIAL')
    data_final = os.getenv('ETL_DATA_FINAL') or date.today().isoformat()

    if not cliente_id:
        log("[ERRO] ETL_CLIENTE não definido no .env")
        sys.exit(1)
    if not data_inicial:
        log("[ERRO] ETL_DATA_INICIAL não definido no .env")
        sys.exit(1)

    log(f"Cliente: {cliente_id}")
    log(f"Período: {data_inicial} a {data_final}")
    log("=" * 60)

    event = {'cliente': cliente_id, 'data_inicial': data_inicial, 'data_final': data_final}

    class LocalContext:
        function_name = "etl-bling-pedidos-vendas-local"
        aws_request_id = "local-execution"

    try:
        lambda_handler(event, LocalContext())
        log("Execução concluída com sucesso!")
    except Exception as e:
        log(f"Execução falhou: {e}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
