"""
ETL: Pedidos da Shopee (Open Platform v2, /order) -> Supabase.

Fluxo:
  1. Lê as lojas conectadas em public.canais_integracoes (plataforma 'shopee', módulo Canais de Venda). store_id = shop_id.
     O access_token vale 4 h e o refresh_token 30 dias; cada renovação devolve um NOVO par. Se o token vence em
     < 15 min, renova e grava o novo par ANTES de usar (perder o par exige reautorizar a loja no dashboard).
  2. Por loja, pagina GET /order/get_order_list (update_time, janelas de até 15 dias, cursor) e busca os detalhes
     em GET /order/get_order_detail (50 pedidos por chamada).
  3. Transforma em cabeçalho (shopee_pedidos) + itens (shopee_pedidos_itens).
  4. Carrega via RPC de upsert (lotes de 500) no schema do tenant. 5. Notifica o Discord.

Loja com token irrecuperável (refresh recusado / autorização vencida) é marcada 'erro' em canais_integracoes e não
derruba as demais; no fim a execução falha se alguma loja falhou.
Assinatura: HMAC-SHA256(partner_key, partner_id + path + timestamp [+ access_token + shop_id]).
Docs: https://open.shopee.com/developer-guide/20
"""

import os
import sys
import json
import time
import hmac
import hashlib
import traceback
import threading
from datetime import date, datetime, timedelta, timezone
from typing import List, Dict, Any, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from dotenv import load_dotenv
load_dotenv()

# --- CONFIGURAÇÃO ---
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_KEY')
DISCORD_WEBHOOK_URL = os.getenv('DISCORD_WEBHOOK_URL')
SHOPEE_PARTNER_ID = os.getenv('SHOPEE_PARTNER_ID')
SHOPEE_PARTNER_KEY = os.getenv('SHOPEE_PARTNER_KEY')
# Produção Brasil. Confirmar no Console/API Test Tool; sandbox: https://openplatform.sandbox.test-stable.shopee.sg
SHOPEE_API_HOST = (os.getenv('SHOPEE_API_HOST') or 'https://openplatform.shopee.com.br').rstrip('/')

LOCAL_MODE = os.getenv('LOCAL_MODE', 'false').lower() == 'true'
LOCAL_CLIENT_CONFIGS = os.getenv('LOCAL_CLIENT_CONFIGS')

http_session = None
rpc_semaphore = threading.Semaphore(3)

MAX_JANELA_DIAS = 15  # get_order_list aceita no máximo 15 dias entre time_from e time_to
POR_PAGINA = 100
DETALHES_POR_CHAMADA = 50
MAX_REQ_POR_SEGUNDO = 4.0
ALTERADOS_HORAS_PADRAO = 24
RENOVAR_SE_FALTAR_SEGUNDOS = 15 * 60
CAMPOS_DETALHE = ",".join([
    "buyer_user_id", "buyer_username", "item_list", "payment_method", "total_amount", "cancel_reason",
    "actual_shipping_fee", "estimated_shipping_fee", "shipping_carrier", "ship_by_date", "pay_time",
])
# Erros da Shopee (campo `error` no JSON, HTTP 200 ou 403) que significam token ruim.
ERROS_DE_TOKEN = ("error_auth", "invalid_access_token", "invalid_refresh_token",
                  "access token", "refresh_token")


class RateLimiter:
    """Limitador de taxa global (thread-safe) por intervalo mínimo entre chamadas."""

    def __init__(self, max_por_segundo: float):
        self.min_intervalo = 1.0 / max_por_segundo
        self.lock = threading.Lock()
        self.ultima_chamada = 0.0

    def aguardar(self):
        with self.lock:
            espera = self.ultima_chamada + self.min_intervalo - time.time()
            if espera > 0:
                time.sleep(espera)
            self.ultima_chamada = time.time()


shopee_rate_limiter = RateLimiter(MAX_REQ_POR_SEGUNDO)


class TokenInvalido(Exception):
    """A Shopee recusou o token e não deu para renovar: é preciso reautorizar a loja no dashboard."""


# --- FUNÇÕES AUXILIARES ---

def log(mensagem: str):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{timestamp}] {mensagem}")


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
        allowed_methods=["HEAD", "GET", "OPTIONS", "POST", "PATCH", "DELETE"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(pool_connections=20, pool_maxsize=50, max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    http_session = session
    return http_session


def _supabase_headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }


def rpc_supabase_com_retry(rpc_name: str, payload: dict, max_retries: int = 3,
                            backoff_factor: float = 1.0, context: str = None):
    context_str = f" [{context}]" if context else ""
    url = f"{SUPABASE_URL}/rest/v1/rpc/{rpc_name}"
    headers = {**_supabase_headers(), "Prefer": "return=minimal"}

    for attempt in range(max_retries + 1):
        with rpc_semaphore:
            try:
                response = get_http_session().post(url, json=payload, headers=headers, timeout=120)
                if response.status_code >= 400:
                    try:
                        log(f"[ERRO SUPABASE {response.status_code}]{context_str} Detalhes: {json.dumps(response.json(), indent=2)}")
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
        for attempt in range(4):
            try:
                response = get_http_session().post(self.webhook_url, json=payload, timeout=10)
                response.raise_for_status()
                return True
            except requests.exceptions.RequestException as e:
                print(f"Erro ao enviar notificação: {e}")
                if attempt < 3:
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
            footer_text = "Execução Local | etl-shopee-pedidos"

        self._send_request({
            "embeds": [{
                "title": "Relatório de Execução ETL - Pedidos (Shopee) 🛍️",
                "color": color,
                "fields": fields,
                "footer": {"text": footer_text},
                "timestamp": datetime.now(timezone.utc).isoformat()
            }]
        })


# --- LOJAS CONECTADAS / TOKENS ---

def obter_configuracoes_clientes() -> dict:
    if not LOCAL_CLIENT_CONFIGS:
        raise ValueError("LOCAL_CLIENT_CONFIGS não configurado no .env")
    return json.loads(LOCAL_CLIENT_CONFIGS)


def listar_lojas_conectadas(tenant_id: str) -> List[dict]:
    """Lojas da Shopee conectadas no dashboard (public.canais_integracoes)."""
    url = (f"{SUPABASE_URL}/rest/v1/canais_integracoes"
           f"?tenant_id=eq.{tenant_id}&plataforma=eq.shopee&status=eq.conectado&access_token=not.is.null"
           "&select=id,nome,store_id,access_token,refresh_token,token_expira_em&order=created_at")
    resp = get_http_session().get(url, headers=_supabase_headers(), timeout=30)
    resp.raise_for_status()
    lojas = resp.json()
    # App do cliente (public.canais_apps: app_id = partner_id, client_secret = partner_key) ou o padrão do repositório.
    partner_id, partner_key = SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY
    r = get_http_session().get(
        f"{SUPABASE_URL}/rest/v1/canais_apps?tenant_id=eq.{tenant_id}&plataforma=eq.shopee&select=app_id,client_secret",
        headers=_supabase_headers(), timeout=30)
    if r.status_code == 200 and r.json():
        partner_id, partner_key = r.json()[0]["app_id"], r.json()[0]["client_secret"]
        log("  Usando o app da Shopee próprio do cliente (public.canais_apps).")
    for loja in lojas:
        loja["_partner_id"], loja["_partner_key"] = partner_id, partner_key
    return lojas


def marcar_canal_com_erro(id_canal: str, mensagem: str):
    """Token irrecuperável: aparece como 'Erro' no módulo Canais de Venda (botão Reconectar)."""
    try:
        resp = get_http_session().patch(
            f"{SUPABASE_URL}/rest/v1/canais_integracoes?id=eq.{id_canal}",
            headers={**_supabase_headers(), "Prefer": "return=minimal"},
            json={"status": "erro", "ultimo_erro": mensagem[:500],
                  "updated_at": datetime.now(timezone.utc).isoformat()},
            timeout=30,
        )
        resp.raise_for_status()
    except Exception as e:
        log(f"[AVISO] Não foi possível marcar o canal {id_canal} com erro: {e}")


def _token_vence_logo(loja: dict) -> bool:
    expira = loja.get("token_expira_em")
    if not expira:
        return True
    try:
        dt = datetime.fromisoformat(expira.replace('Z', '+00:00'))
    except ValueError:
        return True
    return (dt - datetime.now(timezone.utc)).total_seconds() < RENOVAR_SE_FALTAR_SEGUNDOS


def _assinar(partner_key: str, base: str) -> str:
    return hmac.new(partner_key.encode(), base.encode(), hashlib.sha256).hexdigest()


def _erro_de_token(corpo: dict) -> bool:
    texto = f"{corpo.get('error') or ''} {corpo.get('message') or ''}".lower()
    return bool(corpo.get('error')) and any(e in texto for e in ERROS_DE_TOKEN)


def renovar_token(loja: dict):
    """Troca o refresh_token por um novo par e GRAVA no banco antes de qualquer outra coisa."""
    partner_id, partner_key = loja.get("_partner_id"), loja.get("_partner_key")
    if not partner_id or not partner_key:
        raise RuntimeError("SHOPEE_PARTNER_ID/SHOPEE_PARTNER_KEY (ou linha 'shopee' em canais_apps) não definidos: "
                           "necessários para renovar o token.")
    if not loja.get("refresh_token"):
        raise TokenInvalido("Loja sem refresh_token. Reautorize o canal em Canais de Venda.")
    path = "/api/v2/auth/access_token/get"
    ts = int(time.time())
    sign = _assinar(partner_key, f"{partner_id}{path}{ts}")
    resp = get_http_session().post(
        f"{SHOPEE_API_HOST}{path}", params={"partner_id": partner_id, "timestamp": ts, "sign": sign},
        json={"refresh_token": loja["refresh_token"], "partner_id": int(partner_id), "shop_id": int(loja["store_id"])},
        timeout=30)
    corpo = resp.json() if resp.content else {}
    if corpo.get("error") or not corpo.get("access_token"):
        msg = f"{corpo.get('error')}: {corpo.get('message')}" if corpo.get("error") else f"HTTP {resp.status_code}"
        if corpo.get("error") or resp.status_code in (400, 401, 403):
            raise TokenInvalido(f"A Shopee recusou renovar o token da loja {loja['store_id']} ({msg}). "
                                "Reautorize o canal em Canais de Venda (a autorização vale até 365 dias).")
        resp.raise_for_status()
    novo = {
        "access_token": corpo["access_token"],
        "refresh_token": corpo["refresh_token"],
        "token_expira_em": (datetime.now(timezone.utc) + timedelta(seconds=int(corpo.get("expire_in", 14400)))).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    grava = get_http_session().patch(
        f"{SUPABASE_URL}/rest/v1/canais_integracoes?id=eq.{loja['id']}",
        headers={**_supabase_headers(), "Prefer": "return=minimal"}, json=novo, timeout=30)
    grava.raise_for_status()
    loja.update(novo)
    log(f"  Token da loja {loja['store_id']} renovado.")


# --- API DA SHOPEE ---

def _shopee_get(loja: dict, path: str, params: dict) -> dict:
    """GET assinado (API de loja) com limitador de taxa. Erro de token -> renova uma vez e repete."""
    renovado = False
    for tentativa in range(6):
        shopee_rate_limiter.aguardar()
        ts = int(time.time())
        partner_id, partner_key = loja["_partner_id"], loja["_partner_key"]
        sign = _assinar(partner_key, f"{partner_id}{path}{ts}{loja['access_token']}{loja['store_id']}")
        resp = get_http_session().get(
            f"{SHOPEE_API_HOST}{path}", timeout=60,
            params={**params, "partner_id": partner_id, "timestamp": ts, "access_token": loja["access_token"],
                    "shop_id": loja["store_id"], "sign": sign})
        corpo = resp.json() if resp.content else {}
        if resp.status_code == 429 or "rate_limit" in str(corpo.get("error", "")).lower():
            espera = min(2.0 * (tentativa + 1), 20)
            log(f"  [429] Limite da Shopee; aguardando {espera:.0f}s (tentativa {tentativa + 1}/6)")
            time.sleep(espera)
            continue
        if _erro_de_token(corpo):
            if renovado:
                raise TokenInvalido(f"A Shopee recusou o token da loja {loja['store_id']} ({corpo.get('error')}: "
                                    f"{corpo.get('message')}). Reautorize o canal em Canais de Venda.")
            renovar_token(loja)
            renovado = True
            continue
        if corpo.get("error"):
            raise RuntimeError(f"Shopee {path}: {corpo.get('error')} - {corpo.get('message')} "
                               f"(request_id {corpo.get('request_id')})")
        resp.raise_for_status()
        return corpo.get("response") or {}
    raise RuntimeError(f"Shopee limitou repetidamente em {path}")


def listar_numeros_pedidos(loja: dict, desde: datetime, ate: datetime) -> List[str]:
    """order_sn dos pedidos atualizados no intervalo, em janelas de até 15 dias."""
    numeros: List[str] = []
    ini = desde
    while ini < ate:
        fim = min(ini + timedelta(days=MAX_JANELA_DIAS), ate)
        cursor = ""
        while True:
            dados = _shopee_get(loja, "/api/v2/order/get_order_list", {
                "time_range_field": "update_time",
                "time_from": int(ini.timestamp()),
                "time_to": int(fim.timestamp()),
                "page_size": POR_PAGINA,
                "cursor": cursor,
            })
            lote = [p["order_sn"] for p in (dados.get("order_list") or [])]
            numeros.extend(lote)
            log(f"  {ini:%Y-%m-%d} a {fim:%Y-%m-%d}: +{len(lote)} pedido(s) (acumulado {len(numeros)})")
            if not dados.get("more") or not dados.get("next_cursor"):
                break
            cursor = dados["next_cursor"]
        ini = fim
    return list(dict.fromkeys(numeros))


def buscar_detalhes(loja: dict, numeros: List[str]) -> List[dict]:
    pedidos: List[dict] = []
    for i in range(0, len(numeros), DETALHES_POR_CHAMADA):
        dados = _shopee_get(loja, "/api/v2/order/get_order_detail", {
            "order_sn_list": ",".join(numeros[i:i + DETALHES_POR_CHAMADA]),
            "response_optional_fields": CAMPOS_DETALHE,
        })
        pedidos.extend(dados.get("order_list") or [])
    return pedidos


# --- TRANSFORMAÇÃO ---

def _num(valor) -> Optional[float]:
    if valor in (None, ''):
        return None
    try:
        return float(valor)
    except (TypeError, ValueError):
        return None


def _int(valor) -> Optional[int]:
    n = _num(valor)
    return int(n) if n is not None else None


def _txt(valor, limite: int = None) -> Optional[str]:
    if valor in (None, ''):
        return None
    s = str(valor)
    return s[:limite] if limite else s


def _data(epoch) -> Optional[str]:
    """Epoch (segundos) -> ISO UTC; 0/nulo vira None."""
    n = _int(epoch)
    return datetime.fromtimestamp(n, tz=timezone.utc).isoformat() if n else None


def transformar_pedido(pedido: dict, loja: dict, data_extracao: str) -> tuple:
    """Devolve (linha_do_pedido, [linhas_de_itens])."""
    shop_id = int(loja["store_id"])
    order_sn = str(pedido["order_sn"])

    linha = {
        "shop_id": shop_id,
        "order_sn": order_sn,
        "id_canal": loja["id"],
        "status": _txt(pedido.get("order_status"), 30),
        "motivo_cancelamento": _txt(pedido.get("cancel_reason"), 300),
        "criado_em": _data(pedido.get("create_time")),
        "pago_em": _data(pedido.get("pay_time")),
        "atualizado_em": _data(pedido.get("update_time")),
        "enviar_ate": _data(pedido.get("ship_by_date")),
        "total": _num(pedido.get("total_amount")),
        "moeda": _txt(pedido.get("currency"), 5),
        "forma_pagamento": _txt(pedido.get("payment_method"), 80),
        "frete_real": _num(pedido.get("actual_shipping_fee")),
        "frete_estimado": _num(pedido.get("estimated_shipping_fee")),
        "transportadora": _txt(pedido.get("shipping_carrier"), 80),
        "comprador_id": _int(pedido.get("buyer_user_id")),
        "comprador_usuario": _txt(pedido.get("buyer_username"), 100),
        "data_extracao": data_extracao,
    }

    itens = []
    for seq, it in enumerate(pedido.get("item_list") or []):
        itens.append({
            "shop_id": shop_id,
            "order_sn": order_sn,
            "seq": seq,
            "item_id": _int(it.get("item_id")),
            "model_id": _int(it.get("model_id")),
            "sku": _txt(it.get("model_sku") or it.get("item_sku"), 100),
            "titulo": _txt(it.get("item_name"), 300),
            "variacao": _txt(it.get("model_name"), 200),
            "quantidade": _num(it.get("model_quantity_purchased")),
            "preco": _num(it.get("model_discounted_price")),
            "preco_cheio": _num(it.get("model_original_price")),
            "data_extracao": data_extracao,
        })
    return linha, itens


def remover_duplicatas(registros: List[dict], chave: tuple) -> List[dict]:
    vistos = {}
    for r in registros:
        vistos[tuple(r[c] for c in chave)] = r
    return list(vistos.values())


def enviar_em_lotes(registros: List[dict], rpc_name: str, schema: str, tamanho_lote: int = 500, context: str = None):
    for i in range(0, len(registros), tamanho_lote):
        rpc_supabase_com_retry(rpc_name, {"p_data_json": registros[i:i + tamanho_lote], "p_schema_name": schema},
                               context=context)


# --- ORQUESTRAÇÃO ---

def processar_loja(loja: dict, schema: str, desde: datetime) -> tuple:
    """Carrega os pedidos da loja alterados desde `desde`. Devolve (pedidos, itens)."""
    nome = loja.get("nome") or loja["store_id"]
    log(f"Loja '{nome}' (shop {loja['store_id']}): pedidos alterados desde {desde:%Y-%m-%d %H:%M} UTC...")
    if _token_vence_logo(loja):
        renovar_token(loja)
    numeros = listar_numeros_pedidos(loja, desde, datetime.now(timezone.utc))
    log(f"  {len(numeros)} pedido(s) encontrado(s).")
    if not numeros:
        return 0, 0
    pedidos = buscar_detalhes(loja, numeros)

    data_extracao = date.today().isoformat()
    linhas_pedidos: List[dict] = []
    linhas_itens: List[dict] = []
    for pedido in pedidos:
        linha, itens = transformar_pedido(pedido, loja, data_extracao)
        linhas_pedidos.append(linha)
        linhas_itens.extend(itens)

    linhas_pedidos = remover_duplicatas(linhas_pedidos, ("shop_id", "order_sn"))
    linhas_itens = remover_duplicatas(linhas_itens, ("shop_id", "order_sn", "seq"))
    contexto = f"shop {loja['store_id']}"
    enviar_em_lotes(linhas_pedidos, "processar_carga_shopee_pedidos", schema, context=contexto)
    enviar_em_lotes(linhas_itens, "processar_carga_shopee_pedidos_itens", schema, context=contexto)
    log(f"  Carregados: {len(linhas_pedidos)} pedidos, {len(linhas_itens)} itens.")
    return len(linhas_pedidos), len(linhas_itens)


def executar_etl(cliente_id: str, data_inicial_str: Optional[str], alterados_horas: Optional[int]) -> tuple:
    configs = obter_configuracoes_clientes()
    config_cliente = configs.get(cliente_id)
    if not config_cliente:
        raise ValueError(f"Cliente '{cliente_id}' não encontrado nas configurações")
    schema = config_cliente["schema"]
    tenant_id = config_cliente.get("tenant_id")
    if not tenant_id:
        raise ValueError(f"Cliente '{cliente_id}' sem tenant_id em LOCAL_CLIENT_CONFIGS (public.tenants.id): sem ele as lojas de outros clientes seriam lidas.")

    if data_inicial_str:
        desde = datetime.combine(date.fromisoformat(data_inicial_str), datetime.min.time(), tzinfo=timezone.utc)
    else:
        desde = datetime.now(timezone.utc) - timedelta(hours=alterados_horas or ALTERADOS_HORAS_PADRAO)

    lojas = listar_lojas_conectadas(tenant_id)
    if not lojas:
        log("Nenhuma loja da Shopee conectada (módulo Canais de Venda). Nada a fazer.")
        return 0, 0

    total_pedidos = total_itens = 0
    falhas: List[str] = []
    for loja in lojas:
        try:
            pedidos, itens = processar_loja(loja, schema, desde)
            total_pedidos += pedidos
            total_itens += itens
        except TokenInvalido as e:
            log(f"[ERRO] {e}")
            marcar_canal_com_erro(loja["id"], str(e))
            falhas.append(str(e))
        except Exception as e:
            log(f"[ERRO] Loja {loja['store_id']}: {e}")
            traceback.print_exc()
            falhas.append(f"loja {loja['store_id']}: {e}")

    log(f"ETL concluído: {total_pedidos} pedidos, {total_itens} itens em {len(lojas)} loja(s).")
    if falhas:
        raise RuntimeError(f"{len(falhas)} loja(s) com falha: " + " | ".join(falhas))
    return total_pedidos, total_itens


def lambda_handler(event, context):
    start_time = time.time()
    discord_logger = DiscordLogger(DISCORD_WEBHOOK_URL)

    cliente_id = event.get('cliente')
    data_inicial_str = event.get('data_inicial')
    alterados_horas = int(event['alterados_horas']) if event.get('alterados_horas') else None

    if data_inicial_str:
        periodo = f"Alterados desde {data_inicial_str}"
    else:
        periodo = f"Alterados nas últimas {alterados_horas or ALTERADOS_HORAS_PADRAO}h"

    status = "Sucesso"
    error_info = None
    totais = (0, 0)

    try:
        totais = executar_etl(cliente_id, data_inicial_str, alterados_horas)
    except Exception as e:
        status = "Falha"
        error_info = str(e)
        log(f"ERRO FATAL: {e}")
        raise
    finally:
        discord_logger.log_execution(
            status=status,
            context=context,
            cliente=cliente_id,
            periodo=periodo,
            info=f"Pedidos: {totais[0]} | Itens: {totais[1]}",
            execution_time=time.time() - start_time,
            error_message=error_info,
        )


def main():
    log("=" * 60)
    log("ETL SHOPEE PEDIDOS - EXECUÇÃO LOCAL")
    log("=" * 60)

    cliente_id = os.getenv('ETL_CLIENTE')
    data_inicial = os.getenv('ETL_DATA_INICIAL') or None
    alterados_horas = os.getenv('ETL_ALTERADOS_HORAS') or None

    if not cliente_id:
        log("[ERRO] ETL_CLIENTE não definido no .env")
        sys.exit(1)
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        log("[ERRO] SUPABASE_URL/SUPABASE_SERVICE_KEY não definidos")
        sys.exit(1)

    class LocalContext:
        function_name = "etl-shopee-pedidos-local"
        aws_request_id = "local-execution"

    try:
        lambda_handler({'cliente': cliente_id, 'data_inicial': data_inicial, 'alterados_horas': alterados_horas},
                       LocalContext())
        log("Execução concluída com sucesso!")
    except Exception as e:
        log(f"Execução falhou: {e}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
