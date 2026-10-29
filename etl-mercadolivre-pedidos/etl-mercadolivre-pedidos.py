"""
ETL: Pedidos do Mercado Livre (API /orders) -> Supabase.

Fluxo:
  1. Lê as contas conectadas em public.canais_integracoes (plataforma 'mercado-livre', módulo Canais de Venda).
     O access_token vale 6 h e o refresh_token é de USO ÚNICO: se o token vence em < 15 min, renova e grava
     o novo par ANTES de usar (perder o refresh_token novo exige reconectar a conta no dashboard).
  2. Por conta, pagina GET /orders/search?seller={id}&order.date_last_updated.from=... (offset/limit 50).
  3. Transforma em cabeçalho (mercadolivre_pedidos) + itens (mercadolivre_pedidos_itens).
  4. Carrega via RPC de upsert (lotes de 500) no schema do tenant. 5. Notifica o Discord.

Conta com token irrecuperável (invalid_grant / 401 após renovar) é marcada 'erro' em canais_integracoes e não
derruba as demais; no fim a execução falha se alguma conta falhou.
Docs: https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas
"""

import os
import sys
import json
import time
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
MERCADOLIVRE_APP_ID = os.getenv('MERCADOLIVRE_APP_ID')
MERCADOLIVRE_CLIENT_SECRET = os.getenv('MERCADOLIVRE_CLIENT_SECRET')

LOCAL_MODE = os.getenv('LOCAL_MODE', 'false').lower() == 'true'
LOCAL_CLIENT_CONFIGS = os.getenv('LOCAL_CLIENT_CONFIGS')

http_session = None
rpc_semaphore = threading.Semaphore(3)

ML_API_URL = "https://api.mercadolibre.com"
POR_PAGINA = 50  # máximo documentado da busca de orders
MAX_REQ_POR_SEGUNDO = 4.0
ALTERADOS_HORAS_PADRAO = 24
RENOVAR_SE_FALTAR_SEGUNDOS = 15 * 60


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


ml_rate_limiter = RateLimiter(MAX_REQ_POR_SEGUNDO)


class TokenInvalido(Exception):
    """O Mercado Livre recusou o token e não deu para renovar: é preciso reconectar a conta no dashboard."""


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
            footer_text = "Execução Local | etl-mercadolivre-pedidos"

        self._send_request({
            "embeds": [{
                "title": "Relatório de Execução ETL - Pedidos (Mercado Livre) 🛒",
                "color": color,
                "fields": fields,
                "footer": {"text": footer_text},
                "timestamp": datetime.now(timezone.utc).isoformat()
            }]
        })


# --- CONTAS CONECTADAS / TOKENS ---

def obter_configuracoes_clientes() -> dict:
    if not LOCAL_CLIENT_CONFIGS:
        raise ValueError("LOCAL_CLIENT_CONFIGS não configurado no .env")
    return json.loads(LOCAL_CLIENT_CONFIGS)


def listar_contas_conectadas(tenant_id: str) -> List[dict]:
    """Contas do Mercado Livre conectadas no dashboard (public.canais_integracoes)."""
    url = (f"{SUPABASE_URL}/rest/v1/canais_integracoes"
           f"?tenant_id=eq.{tenant_id}&plataforma=eq.mercado-livre&status=eq.conectado&access_token=not.is.null"
           "&select=id,nome,store_id,access_token,refresh_token,token_expira_em&order=created_at")
    resp = get_http_session().get(url, headers=_supabase_headers(), timeout=30)
    resp.raise_for_status()
    contas = resp.json()
    # App do cliente (public.canais_apps) ou, sem linha, o da Barbers World (segredos do repositório).
    app_id, secret = MERCADOLIVRE_APP_ID, MERCADOLIVRE_CLIENT_SECRET
    r = get_http_session().get(
        f"{SUPABASE_URL}/rest/v1/canais_apps?tenant_id=eq.{tenant_id}&plataforma=eq.mercado-livre&select=app_id,client_secret",
        headers=_supabase_headers(), timeout=30)
    if r.status_code == 200 and r.json():
        app_id, secret = r.json()[0]["app_id"], r.json()[0]["client_secret"]
        log("  Usando o app do Mercado Livre próprio do cliente (public.canais_apps).")
    for c in contas:
        c["_app_id"], c["_client_secret"] = app_id, secret
    return contas


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


def _token_vence_logo(conta: dict) -> bool:
    expira = conta.get("token_expira_em")
    if not expira:
        return True
    try:
        dt = datetime.fromisoformat(expira.replace('Z', '+00:00'))
    except ValueError:
        return True
    return (dt - datetime.now(timezone.utc)).total_seconds() < RENOVAR_SE_FALTAR_SEGUNDOS


def renovar_token(conta: dict):
    """Troca o refresh_token (uso único) por um novo par e GRAVA no banco antes de qualquer outra coisa."""
    app_id, client_secret = conta.get("_app_id"), conta.get("_client_secret")
    if not app_id or not client_secret:
        raise RuntimeError("MERCADOLIVRE_APP_ID/MERCADOLIVRE_CLIENT_SECRET não definidos (necessários para renovar o token).")
    if not conta.get("refresh_token"):
        raise TokenInvalido("Conta sem refresh_token. Reconecte o canal em Canais de Venda.")
    resp = get_http_session().post(
        f"{ML_API_URL}/oauth/token",
        headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
        data={"grant_type": "refresh_token", "client_id": app_id,
              "client_secret": client_secret, "refresh_token": conta["refresh_token"]},
        timeout=30,
    )
    corpo = resp.json() if resp.content else {}
    if resp.status_code in (400, 401, 403) and corpo.get("error") in ("invalid_grant", "invalid_client", "unauthorized_client"):
        raise TokenInvalido(f"O Mercado Livre recusou renovar o token da conta {conta['store_id']} "
                            f"({corpo.get('error')}). Reconecte o canal em Canais de Venda.")
    resp.raise_for_status()
    novo = {
        "access_token": corpo["access_token"],
        "refresh_token": corpo["refresh_token"],
        "token_expira_em": (datetime.now(timezone.utc) + timedelta(seconds=int(corpo.get("expires_in", 21600)))).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    grava = get_http_session().patch(
        f"{SUPABASE_URL}/rest/v1/canais_integracoes?id=eq.{conta['id']}",
        headers={**_supabase_headers(), "Prefer": "return=minimal"}, json=novo, timeout=30)
    grava.raise_for_status()
    conta.update(novo)
    log(f"  Token da conta {conta['store_id']} renovado.")


# --- API DO MERCADO LIVRE ---

def _ml_get(conta: dict, path: str, params: dict) -> dict:
    """GET autenticado com limitador de taxa. 401 -> renova o token uma vez e repete."""
    renovado = False
    for tentativa in range(6):
        ml_rate_limiter.aguardar()
        resp = get_http_session().get(
            f"{ML_API_URL}{path}", params=params, timeout=60,
            headers={"Authorization": f"Bearer {conta['access_token']}", "Accept": "application/json"})
        if resp.status_code == 429:
            espera = min(2.0 * (tentativa + 1), 20)
            log(f"  [429] Limite do Mercado Livre; aguardando {espera:.0f}s (tentativa {tentativa + 1}/6)")
            time.sleep(espera)
            continue
        if resp.status_code in (401, 403):
            if renovado:
                raise TokenInvalido(f"O Mercado Livre recusou o token da conta {conta['store_id']} (HTTP {resp.status_code}). "
                                    "Reconecte o canal em Canais de Venda.")
            renovar_token(conta)
            renovado = True
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError(f"Mercado Livre respondeu 429 repetidamente em {path}")


def listar_pedidos(conta: dict, atualizados_desde: datetime) -> List[dict]:
    pedidos: List[dict] = []
    offset = 0
    desde = atualizados_desde.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000-00:00')
    while True:
        dados = _ml_get(conta, "/orders/search", {
            "seller": conta["store_id"],
            "order.date_last_updated.from": desde,
            "sort": "date_asc",
            "limit": POR_PAGINA,
            "offset": offset,
        })
        itens = dados.get("results") or []
        pedidos.extend(itens)
        total = (dados.get("paging") or {}).get("total", 0)
        log(f"  offset {offset}: {len(itens)} pedido(s) (acumulado {len(pedidos)} de {total})")
        offset += POR_PAGINA
        if not itens or offset >= total:
            break
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


def _soma(valores) -> Optional[float]:
    nums = [v for v in valores if v is not None]
    return round(sum(nums), 2) if nums else None


def transformar_pedido(pedido: dict, conta: dict, data_extracao: str) -> tuple:
    """Devolve (linha_do_pedido, [linhas_de_itens])."""
    seller_id = int(conta["store_id"])
    id_pedido = int(pedido["id"])
    itens_api = pedido.get("order_items") or []
    pagamentos = pedido.get("payments") or []
    aprovado = next((p for p in pagamentos if p.get("status") == "approved"), pagamentos[0] if pagamentos else {})
    comprador = pedido.get("buyer") or {}
    cancelamento = pedido.get("cancel_detail") or {}
    contexto = pedido.get("context") or {}

    linha = {
        "seller_id": seller_id,
        "id_pedido": id_pedido,
        "id_canal": conta["id"],
        "pack_id": _int(pedido.get("pack_id")),
        "status": _txt(pedido.get("status"), 30),
        "status_detalhe": _txt(pedido.get("status_detail"), 100),
        "tags": _txt(",".join(pedido.get("tags") or [])),
        "motivo_cancelamento": _txt(cancelamento.get("description") or cancelamento.get("code"), 200),
        "criado_em": pedido.get("date_created"),
        "fechado_em": pedido.get("date_closed"),
        "atualizado_em": pedido.get("last_updated") or pedido.get("date_last_updated"),
        "total": _num(pedido.get("total_amount")),
        "total_pago": _num(pedido.get("paid_amount")),
        "moeda": _txt(pedido.get("currency_id"), 5),
        "comissao": _soma([(_num(i.get("sale_fee")) or 0) * (_num(i.get("quantity")) or 0) for i in itens_api]),
        "taxa_pagamento": _soma([_num(p.get("marketplace_fee")) for p in pagamentos]),
        "frete_id": _int((pedido.get("shipping") or {}).get("id")),
        "forma_pagamento": _txt(aprovado.get("payment_method_id"), 40),
        "tipo_pagamento": _txt(aprovado.get("payment_type"), 40),
        "parcelas": _int(aprovado.get("installments")),
        "canal_origem": _txt(contexto.get("channel"), 30),
        "comprador_id": _int(comprador.get("id")),
        "comprador_apelido": _txt(comprador.get("nickname"), 100),
        "data_extracao": data_extracao,
    }

    itens = []
    for seq, oi in enumerate(itens_api):
        item = oi.get("item") or {}
        itens.append({
            "seller_id": seller_id,
            "id_pedido": id_pedido,
            "seq": seq,
            "id_anuncio": _txt(item.get("id"), 20),
            "id_variacao": _int(item.get("variation_id")),
            "sku": _txt(item.get("seller_sku") or item.get("seller_custom_field"), 100),
            "titulo": _txt(item.get("title"), 300),
            "categoria_id": _txt(item.get("category_id"), 20),
            "quantidade": _num(oi.get("quantity")),
            "preco": _num(oi.get("unit_price")),
            "preco_cheio": _num(oi.get("full_unit_price")),
            "comissao_unit": _num(oi.get("sale_fee")),
            "tipo_anuncio": _txt(oi.get("listing_type_id"), 30),
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

def processar_conta(conta: dict, schema: str, desde: datetime) -> tuple:
    """Carrega os pedidos da conta alterados desde `desde`. Devolve (pedidos, itens)."""
    nome = conta.get("nome") or conta["store_id"]
    log(f"Conta '{nome}' (vendedor {conta['store_id']}): pedidos alterados desde {desde:%Y-%m-%d %H:%M} UTC...")
    if _token_vence_logo(conta):
        renovar_token(conta)
    pedidos = listar_pedidos(conta, desde)
    log(f"  {len(pedidos)} pedido(s) encontrado(s).")
    if not pedidos:
        return 0, 0

    data_extracao = date.today().isoformat()
    linhas_pedidos: List[dict] = []
    linhas_itens: List[dict] = []
    for pedido in pedidos:
        linha, itens = transformar_pedido(pedido, conta, data_extracao)
        linhas_pedidos.append(linha)
        linhas_itens.extend(itens)

    linhas_pedidos = remover_duplicatas(linhas_pedidos, ("seller_id", "id_pedido"))
    linhas_itens = remover_duplicatas(linhas_itens, ("seller_id", "id_pedido", "seq"))
    contexto = f"vendedor {conta['store_id']}"
    enviar_em_lotes(linhas_pedidos, "processar_carga_mercadolivre_pedidos", schema, context=contexto)
    enviar_em_lotes(linhas_itens, "processar_carga_mercadolivre_pedidos_itens", schema, context=contexto)
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

    contas = listar_contas_conectadas(tenant_id)
    if not contas:
        log("Nenhuma conta do Mercado Livre conectada (módulo Canais de Venda). Nada a fazer.")
        return 0, 0

    total_pedidos = total_itens = 0
    falhas: List[str] = []
    for conta in contas:
        try:
            pedidos, itens = processar_conta(conta, schema, desde)
            total_pedidos += pedidos
            total_itens += itens
        except TokenInvalido as e:
            log(f"[ERRO] {e}")
            marcar_canal_com_erro(conta["id"], str(e))
            falhas.append(str(e))
        except Exception as e:
            log(f"[ERRO] Conta {conta['store_id']}: {e}")
            traceback.print_exc()
            falhas.append(f"conta {conta['store_id']}: {e}")

    log(f"ETL concluído: {total_pedidos} pedidos, {total_itens} itens em {len(contas)} conta(s).")
    if falhas:
        raise RuntimeError(f"{len(falhas)} conta(s) com falha: " + " | ".join(falhas))
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
    log("ETL MERCADO LIVRE PEDIDOS - EXECUÇÃO LOCAL")
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
        function_name = "etl-mercadolivre-pedidos-local"
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
