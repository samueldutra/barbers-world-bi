"""
ETL: Catálogo de produtos da Nuvemshop (API v1) -> Supabase (barbers.nuvemshop_produtos).

Fluxo:
  1. Lê as lojas conectadas em public.canais_integracoes (módulo Canais de Venda do dashboard):
     o access_token da Nuvemshop não expira, então não há refresh. Precisa do escopo read_products.
  2. Por loja, pagina GET /v1/{store_id}/products (200 por página; ~10 requisições pro catálogo todo,
     as variantes e o SKU de cada uma vêm dentro do produto).
  3. Transforma em UMA LINHA POR VARIANTE (o SKU que vincula ao Bling é o da variante).
  4. Carrega via RPC de upsert (lotes de 500) e, só se TODAS as páginas foram lidas, remove da tabela
     o que sumiu da Nuvemshop (RPC limpar_nuvemshop_produtos_removidos).
  5. Notifica o resultado no Discord.

O catálogo é lido inteiro a cada execução (não há filtro incremental confiável e são poucas páginas).
Uma loja com token recusado (401/403) é marcada com status 'erro' em canais_integracoes e não derruba as
demais; no fim a execução falha se alguma loja falhou.
Docs: https://tiendanube.github.io/api-documentation/resources/product
"""

import os
import sys
import json
import time
import traceback
import threading
from datetime import datetime, timezone
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

    def log_execution(self, status: str, context, cliente: str,
                       info: str, execution_time: float, error_message: str = None):
        color = 3066993 if status.lower() == "sucesso" else 15158332
        fields = [
            {"name": "Cliente", "value": cliente or "N/A", "inline": True},
            {"name": "Status", "value": f"**{status}**", "inline": True},
            {"name": "Registros", "value": f"```{info}```", "inline": False},
            {"name": "Tempo", "value": f"{execution_time:.2f}s", "inline": False}
        ]
        if error_message:
            error_text = (error_message[:1024 - 6] + '...') if len(error_message) > 1024 else error_message
            fields.append({"name": "Erro", "value": f"```\n{error_text}\n```", "inline": False})

        if context and hasattr(context, 'function_name'):
            footer_text = f"Function: {context.function_name} | Request ID: {context.aws_request_id}"
        else:
            footer_text = "Execução Local | etl-nuvemshop-produtos"

        self._send_request({
            "embeds": [{
                "title": "Relatório de Execução ETL - Produtos (Nuvemshop) 🛍️",
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


def listar_produtos(loja: dict) -> List[dict]:
    """Catálogo completo da loja (todas as páginas)."""
    produtos: List[dict] = []
    pagina = 1
    while True:
        params = {
            "per_page": POR_PAGINA,
            "page": pagina,
            "fields": "id,name,published,canonical_url,images,variants,created_at,updated_at",
        }
        itens = _nuvemshop_get(loja, "/products", params)
        if not itens:
            break
        produtos.extend(itens)
        log(f"  página {pagina}: {len(itens)} produto(s) (acumulado {len(produtos)})")
        if len(itens) < POR_PAGINA:
            break
        pagina += 1
    return produtos


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


def _txt(valor, limite: int = None) -> Optional[str]:
    if valor in (None, ''):
        return None
    s = str(valor)
    return s[:limite] if limite else s


def _texto_i18n(valor) -> Optional[str]:
    """Campos de texto da Nuvemshop vêm por idioma ({"pt": "..."}); prefere o português."""
    if isinstance(valor, dict):
        return valor.get("pt") or next((v for v in valor.values() if v), None)
    return valor


def _nome_variacao(variante: dict) -> Optional[str]:
    """Ex.: "110V / Preto" a partir de variant.values ([{"pt": "110V"}, {"pt": "Preto"}])."""
    partes = [_texto_i18n(v) for v in (variante.get("values") or [])]
    return " / ".join(p for p in partes if p) or None


def transformar_produto(produto: dict, loja: dict, data_sincronizacao: str) -> List[dict]:
    """Devolve uma linha por variante do produto. O SKU é gravado como está (sem trim): a
    normalização fica no banco, que assim consegue apontar o que precisa de ajuste."""
    store_id = int(loja["store_id"])
    imagens = produto.get("images") or []
    imagem = imagens[0].get("src") if imagens and isinstance(imagens[0], dict) else None
    linhas = []
    for v in produto.get("variants") or []:
        if v.get("id") is None:
            continue
        linhas.append({
            "store_id": store_id,
            "id_produto": int(produto["id"]),
            "id_variante": int(v["id"]),
            "id_canal": loja["id"],
            "nome": _txt(_texto_i18n(produto.get("name")), 300),
            "variacao": _txt(_nome_variacao(v), 200),
            "sku": _txt(v.get("sku"), 100),
            "codigo_barras": _txt(v.get("barcode"), 60),
            "publicado": bool(produto.get("published")),
            "preco": _num(v.get("price")),
            "preco_promocional": _num(v.get("promotional_price")),
            "estoque": _num(v.get("stock")),
            "url": _txt(produto.get("canonical_url")),
            "imagem_url": _txt(imagem),
            "criado_em": _ts(v.get("created_at") or produto.get("created_at")),
            "atualizado_em": _ts(v.get("updated_at") or produto.get("updated_at")),
            "data_sincronizacao": data_sincronizacao,
        })
    return linhas


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

def processar_loja(loja: dict, schema: str, inicio_execucao: datetime) -> tuple:
    """Carrega o catálogo da loja. Devolve (produtos, variantes, removidos)."""
    nome = loja.get("nome") or loja["store_id"]
    log(f"Loja '{nome}' (nº {loja['store_id']}): lendo o catálogo...")
    produtos = listar_produtos(loja)
    log(f"  {len(produtos)} produto(s) encontrado(s).")
    if not produtos:
        # Catálogo vazio pode ser falha de leitura: não apaga nada por precaução.
        return 0, 0, 0

    data_sincronizacao = inicio_execucao.isoformat()
    linhas: List[dict] = []
    for produto in produtos:
        linhas.extend(transformar_produto(produto, loja, data_sincronizacao))
    linhas = remover_duplicatas(linhas, ("store_id", "id_produto", "id_variante"))

    contexto = f"loja {loja['store_id']}"
    enviar_em_lotes(linhas, "processar_carga_nuvemshop_produtos", schema, context=contexto)
    # Chegou até aqui = todas as páginas lidas e carregadas: o que não foi tocado nesta execução foi excluído.
    resp = rpc_supabase_com_retry(
        "limpar_nuvemshop_produtos_removidos",
        {"p_schema_name": schema, "p_store_id": int(loja["store_id"]), "p_antes_de": data_sincronizacao},
        context=contexto,
    )
    try:
        removidos = int(resp.json())
    except Exception:
        removidos = 0
    log(f"  Carregadas: {len(linhas)} variantes de {len(produtos)} produtos; {removidos} removida(s) (sumiram da loja).")
    return len(produtos), len(linhas), removidos


def executar_etl(cliente_id: str) -> tuple:
    configs = obter_configuracoes_clientes()
    config_cliente = configs.get(cliente_id)
    if not config_cliente:
        raise ValueError(f"Cliente '{cliente_id}' não encontrado nas configurações")
    schema = config_cliente["schema"]

    lojas = listar_lojas_conectadas()
    if not lojas:
        log("Nenhuma loja Nuvemshop conectada (módulo Canais de Venda). Nada a fazer.")
        return 0, 0, 0

    inicio_execucao = datetime.now(timezone.utc)
    total_produtos = total_variantes = total_removidos = 0
    falhas: List[str] = []
    for loja in lojas:
        try:
            produtos, variantes, removidos = processar_loja(loja, schema, inicio_execucao)
            total_produtos += produtos
            total_variantes += variantes
            total_removidos += removidos
        except TokenInvalido as e:
            log(f"[ERRO] {e}")
            marcar_canal_com_erro(loja["id"], str(e))
            falhas.append(str(e))
        except Exception as e:
            log(f"[ERRO] Loja {loja['store_id']}: {e}")
            traceback.print_exc()
            falhas.append(f"loja {loja['store_id']}: {e}")

    log(f"ETL concluído: {total_produtos} produtos, {total_variantes} variantes, {total_removidos} removidas "
        f"em {len(lojas)} loja(s).")
    if falhas:
        raise RuntimeError(f"{len(falhas)} loja(s) com falha: " + " | ".join(falhas))
    return total_produtos, total_variantes, total_removidos


def lambda_handler(event, context):
    start_time = time.time()
    discord_logger = DiscordLogger(DISCORD_WEBHOOK_URL)
    cliente_id = event.get('cliente')

    status = "Sucesso"
    error_info = None
    totais = (0, 0, 0)

    try:
        totais = executar_etl(cliente_id)
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
            info=f"Produtos: {totais[0]} | Variantes: {totais[1]} | Removidas: {totais[2]}",
            execution_time=time.time() - start_time,
            error_message=error_info,
        )


def main():
    log("=" * 60)
    log("ETL NUVEMSHOP PRODUTOS - EXECUÇÃO LOCAL")
    log("=" * 60)

    cliente_id = os.getenv('ETL_CLIENTE')
    if not cliente_id:
        log("[ERRO] ETL_CLIENTE não definido no .env")
        sys.exit(1)
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        log("[ERRO] SUPABASE_URL/SUPABASE_SERVICE_KEY não definidos")
        sys.exit(1)

    class LocalContext:
        function_name = "etl-nuvemshop-produtos-local"
        aws_request_id = "local-execution"

    try:
        lambda_handler({'cliente': cliente_id}, LocalContext())
        log("Execução concluída com sucesso!")
    except Exception as e:
        log(f"Execução falhou: {e}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
