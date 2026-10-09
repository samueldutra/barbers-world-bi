"""
ETL: Pedidos da Nuvemshop (API v1) -> Supabase.

Fluxo:
  1. Lê as lojas conectadas em public.canais_integracoes (módulo Canais de Venda do dashboard):
     o access_token da Nuvemshop não expira, então não há refresh.
  2. Por loja, pagina GET /v1/{store_id}/orders?updated_at_min=... (pedido novo também conta
     como "alterado"; os itens já vêm dentro do pedido — 1 requisição por página de 200).
  3. Transforma em cabeçalho (nuvemshop_pedidos) + itens (nuvemshop_pedidos_itens).
  4. Carrega via RPC de upsert (lotes de 500) no schema do tenant.
  5. Notifica o resultado no Discord.

Uma loja com token revogado (app desinstalado: 401/403) é marcada com status 'erro' em
canais_integracoes e não derruba as demais; no fim a execução falha se alguma loja falhou.
Docs: https://tiendanube.github.io/api-documentation/resources/order
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

LOCAL_MODE = os.getenv('LOCAL_MODE', 'false').lower() == 'true'
LOCAL_CLIENT_CONFIGS = os.getenv('LOCAL_CLIENT_CONFIGS')

http_session = None
rpc_semaphore = threading.Semaphore(3)

NUVEMSHOP_API_URL = "https://api.nuvemshop.com.br/v1"
NUVEMSHOP_USER_AGENT = "Barbers World BI ETL (samueldutra.rp@gmail.com)"
POR_PAGINA = 200  # máximo da API
# Balde da Nuvemshop: 40 requisições, vaza 2/s. Usamos 1,5 req/s e respeitamos o 429.
MAX_REQ_POR_SEGUNDO = 1.5
ALTERADOS_HORAS_PADRAO = 24


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


nuvemshop_rate_limiter = RateLimiter(MAX_REQ_POR_SEGUNDO)


class TokenInvalido(Exception):
    """A Nuvemshop recusou o token (401/403): app desinstalado ou token revogado."""


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
            footer_text = "Execução Local | etl-nuvemshop-pedidos"

        self._send_request({
            "embeds": [{
                "title": "Relatório de Execução ETL - Pedidos (Nuvemshop) 🛍️",
                "color": color,
                "fields": fields,
                "footer": {"text": footer_text},
                "timestamp": datetime.now(timezone.utc).isoformat()
            }]
        })


# --- CONFIGURAÇÕES / LOJAS CONECTADAS ---

def obter_configuracoes_clientes() -> dict:
    if not LOCAL_CLIENT_CONFIGS:
        raise ValueError("LOCAL_CLIENT_CONFIGS não configurado no .env")
    return json.loads(LOCAL_CLIENT_CONFIGS)


def listar_lojas_conectadas() -> List[dict]:
    """Lojas Nuvemshop conectadas no dashboard (public.canais_integracoes)."""
    url = (f"{SUPABASE_URL}/rest/v1/canais_integracoes"
           "?plataforma=eq.nuvemshop&status=eq.conectado&access_token=not.is.null"
           "&select=id,nome,store_id,access_token&order=created_at")
    resp = get_http_session().get(url, headers=_supabase_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json()


def marcar_canal_com_erro(id_canal: str, mensagem: str):
    """Token recusado: aparece como 'Erro' no módulo Canais de Venda (botão Reconectar)."""
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


# --- API DA NUVEMSHOP ---

def _nuvemshop_get(loja: dict, path: str, params: dict) -> Optional[list]:
    """GET com limitador de taxa. Devolve None quando a API responde 404 (página além da última
    ou nenhum pedido no filtro — a Nuvemshop usa 404 para 'lista vazia')."""
    url = f"{NUVEMSHOP_API_URL}/{loja['store_id']}{path}"
    headers = {
        "Authentication": f"bearer {loja['access_token']}",
        "User-Agent": NUVEMSHOP_USER_AGENT,
        "Accept": "application/json",
    }
    for tentativa in range(6):
        nuvemshop_rate_limiter.aguardar()
        resp = get_http_session().get(url, headers=headers, params=params, timeout=60)
        if resp.status_code == 429:
            # X-Rate-Limit-Reset = ms até o balde esvaziar o suficiente.
            espera = min(float(resp.headers.get('x-rate-limit-reset', 2000)) / 1000.0 + 0.5, 30)
            log(f"  [429] Limite da Nuvemshop; aguardando {espera:.1f}s (tentativa {tentativa + 1}/6)")
            time.sleep(espera)
            continue
        if resp.status_code == 404:
            return None
        if resp.status_code in (401, 403):
            raise TokenInvalido(f"A Nuvemshop recusou o token da loja {loja['store_id']} (HTTP {resp.status_code}). "
                                "Reconecte o canal em Canais de Venda.")
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError(f"Nuvemshop respondeu 429 repetidamente em {path}")


def listar_pedidos(loja: dict, atualizados_desde: datetime) -> List[dict]:
    pedidos: List[dict] = []
    pagina = 1
    while True:
        params = {
            "updated_at_min": atualizados_desde.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00'),
            "status": "any",
            "per_page": POR_PAGINA,
            "page": pagina,
        }
        itens = _nuvemshop_get(loja, "/orders", params)
        if not itens:
            break
        pedidos.extend(itens)
        log(f"  página {pagina}: {len(itens)} pedido(s) (acumulado {len(pedidos)})")
        if len(itens) < POR_PAGINA:
            break
        pagina += 1
    return pedidos


# --- TRANSFORMAÇÃO ---

def _ts(valor) -> Optional[str]:
    """Nuvemshop manda '2026-10-09T12:00:00+0000'; normaliza para ISO com ':' no fuso."""
    if not valor or not isinstance(valor, str):
        return None
    if len(valor) >= 5 and valor[-5] in '+-' and valor[-3] != ':':
        return f"{valor[:-2]}:{valor[-2:]}"
    return valor


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


def _desconto_promocional(pedido: dict) -> Optional[float]:
    promo = pedido.get("promotional_discount")
    return _num(promo.get("total_discount_amount")) if isinstance(promo, dict) else None


def transformar_pedido(pedido: dict, loja: dict, data_extracao: str) -> tuple:
    """Devolve (linha_do_pedido, [linhas_de_itens])."""
    store_id = int(loja["store_id"])
    id_pedido = int(pedido["id"])
    cliente = pedido.get("customer") or {}
    entrega = pedido.get("shipping_address") or {}
    pagamento = pedido.get("payment_details") or {}
    cupons = pedido.get("coupon") or []
    codigos = ",".join(str(c.get("code")) for c in cupons if isinstance(c, dict) and c.get("code"))

    linha = {
        "store_id": store_id,
        "id_pedido": id_pedido,
        "id_canal": loja["id"],
        "numero": _int(pedido.get("number")),
        "status": _txt(pedido.get("status"), 20),
        "status_pagamento": _txt(pedido.get("payment_status"), 20),
        "status_envio": _txt(pedido.get("shipping_status"), 20),
        "motivo_cancelamento": _txt(pedido.get("cancel_reason"), 50),
        "criado_em": _ts(pedido.get("created_at")),
        "atualizado_em": _ts(pedido.get("updated_at")),
        "pago_em": _ts(pedido.get("paid_at")),
        "enviado_em": _ts(pedido.get("shipped_at")),
        "fechado_em": _ts(pedido.get("closed_at")),
        "cancelado_em": _ts(pedido.get("cancelled_at")),
        "subtotal": _num(pedido.get("subtotal")),
        "desconto": _num(pedido.get("discount")),
        "desconto_cupom": _num(pedido.get("discount_coupon")),
        "desconto_gateway": _num(pedido.get("discount_gateway")),
        "desconto_promocional": _desconto_promocional(pedido),
        "frete_cliente": _num(pedido.get("shipping_cost_customer")),
        "frete_loja": _num(pedido.get("shipping_cost_owner")),
        "total": _num(pedido.get("total")),
        "moeda": _txt(pedido.get("currency"), 5),
        "gateway": _txt(pedido.get("gateway_name") or pedido.get("gateway"), 60),
        "forma_pagamento": _txt(pagamento.get("method"), 40),
        "bandeira_cartao": _txt(pagamento.get("credit_card_company"), 40),
        "parcelas": _int(pagamento.get("installments")),
        "cupons": codigos or None,
        "opcao_envio": _txt(pedido.get("shipping_option"), 120),
        "loja_virtual": _txt(pedido.get("storefront"), 60),
        "cliente_id": _int(cliente.get("id")),
        "cliente_nome": _txt(cliente.get("name") or pedido.get("contact_name"), 200),
        "cliente_email": _txt(cliente.get("email") or pedido.get("contact_email"), 200),
        "cliente_telefone": _txt(cliente.get("phone") or pedido.get("contact_phone"), 40),
        "cliente_documento": _txt(cliente.get("identification") or pedido.get("contact_identification"), 30),
        "entrega_cidade": _txt(entrega.get("city"), 100),
        "entrega_uf": _txt(entrega.get("province"), 60),
        "entrega_cep": _txt(entrega.get("zipcode"), 20),
        "observacao_cliente": _txt(pedido.get("note")),
        "observacao_loja": _txt(pedido.get("owner_note")),
        "data_extracao": data_extracao,
    }

    itens = []
    for p in pedido.get("products") or []:
        if p.get("id") is None:
            continue
        itens.append({
            "store_id": store_id,
            "id_pedido": id_pedido,
            "id_item": int(p["id"]),
            "id_produto": _int(p.get("product_id")),
            "id_variante": _int(p.get("variant_id")),
            "sku": _txt(p.get("sku"), 100),
            "codigo_barras": _txt(p.get("barcode"), 60),
            "nome": _txt(p.get("name"), 300),
            "quantidade": _num(p.get("quantity")),
            "preco": _num(p.get("price")),
            "custo": _num(p.get("cost")),
            "peso": _num(p.get("weight")),
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
    log(f"Loja '{nome}' (nº {loja['store_id']}): pedidos alterados desde {desde:%Y-%m-%d %H:%M} UTC...")
    pedidos = listar_pedidos(loja, desde)
    log(f"  {len(pedidos)} pedido(s) encontrado(s).")
    if not pedidos:
        return 0, 0

    data_extracao = date.today().isoformat()
    linhas_pedidos: List[dict] = []
    linhas_itens: List[dict] = []
    for pedido in pedidos:
        linha, itens = transformar_pedido(pedido, loja, data_extracao)
        linhas_pedidos.append(linha)
        linhas_itens.extend(itens)

    linhas_pedidos = remover_duplicatas(linhas_pedidos, ("store_id", "id_pedido"))
    linhas_itens = remover_duplicatas(linhas_itens, ("store_id", "id_pedido", "id_item"))
    contexto = f"loja {loja['store_id']}"
    enviar_em_lotes(linhas_pedidos, "processar_carga_nuvemshop_pedidos", schema, context=contexto)
    enviar_em_lotes(linhas_itens, "processar_carga_nuvemshop_pedidos_itens", schema, context=contexto)
    log(f"  Carregados: {len(linhas_pedidos)} pedidos, {len(linhas_itens)} itens.")
    return len(linhas_pedidos), len(linhas_itens)


def executar_etl(cliente_id: str, data_inicial_str: Optional[str], alterados_horas: Optional[int]) -> tuple:
    configs = obter_configuracoes_clientes()
    config_cliente = configs.get(cliente_id)
    if not config_cliente:
        raise ValueError(f"Cliente '{cliente_id}' não encontrado nas configurações")
    schema = config_cliente["schema"]

    if data_inicial_str:
        desde = datetime.combine(date.fromisoformat(data_inicial_str), datetime.min.time(), tzinfo=timezone.utc)
    else:
        desde = datetime.now(timezone.utc) - timedelta(hours=alterados_horas or ALTERADOS_HORAS_PADRAO)

    lojas = listar_lojas_conectadas()
    if not lojas:
        log("Nenhuma loja Nuvemshop conectada (módulo Canais de Venda). Nada a fazer.")
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
    log("ETL NUVEMSHOP PEDIDOS - EXECUÇÃO LOCAL")
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
        function_name = "etl-nuvemshop-pedidos-local"
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
