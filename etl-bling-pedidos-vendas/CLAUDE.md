# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Responder sempre em português do Brasil.

## Comandos

```bash
# Setup
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # preencher

# Autorização OAuth do Bling (uma vez, abre o navegador)
python bling_oauth_bootstrap.py

# Execução local do ETL (requer .env com LOCAL_MODE=true e tokens já em public.bling_oauth)
python etl-bling-pedidos-vendas.py
```

## Arquitetura

ETL de pedidos de venda do Bling (API v3) → Supabase. Segue os padrões de
`~/Devingá/repo/etl-faturamento` (ver `LAMBDA_ETL_TEMPLATE.md` lá) com duas diferenças
principais em relação ao template original (que foi feito pro ERP SG Sistemas):

1. **Autenticação OAuth 2.0** em vez de Bearer simples — ver seção OAuth abaixo.
2. **Duas tabelas de destino** (não uma): `pedidos_vendas` (grão pedido+item) e
   `pedidos_vendas_parcelas` (grão pedido+parcela), porque parcelas e itens têm
   cardinalidades independentes — juntar os dois em uma única linha geraria produto
   cartesiano incorreto.

### Fluxo de Execução

1. `lambda_handler()` recebe evento com `cliente`, `data_inicial`, `data_final`.
2. `executar_etl()` divide o período em blocos mensais (`dividir_periodo_em_meses`).
3. Por bloco: `obter_access_token_valido()` garante um token OAuth válido (renova se
   necessário) → `listar_ids_pedidos()` pagina `GET /pedidos/vendas` (só retorna
   cabeçalho resumido, sem itens/parcelas) → `buscar_detalhe_pedido()` busca
   `GET /pedidos/vendas/{id}` para cada id (com. `ThreadPoolExecutor` +
   `BLING_MAX_WORKERS_DETALHE=3` workers, respeitando `RateLimiter` global).
4. `transformar_pedido()` denormaliza cada pedido em N linhas de item + N linhas de parcela.
5. `enviar_em_lotes()` chama as RPCs de upsert em lotes de 500.
6. `DiscordLogger` notifica o resultado.

### OAuth do Bling

Fonte de verdade dos tokens: tabela `public.bling_oauth` (1 linha por `conta`), **não**
`.env`/SSM — o `refresh_token` roda a cada renovação e precisa ficar em algum lugar
persistente e compartilhável entre execuções local/Lambda.

- `client_id`/`client_secret`/`redirect_uri` do app Bling: `.env` local
  (`BLING_CLIENT_ID`/`BLING_CLIENT_SECRET`/`BLING_REDIRECT_URI`) ou SSM
  `/etl/bling/{cliente_id}/app` na AWS.
- Autorização inicial (uma vez, navegador): `bling_oauth_bootstrap.py`. URLs de
  autorização/token são em `bling.com.br` (sem `www.`/`api.`), diferente do host da API
  (`api.bling.com.br`) — confirmado no OpenAPI oficial
  (`https://developer.bling.com.br/build/assets/openapi-*.json`,
  `components.securitySchemes.OAuth2`).
- `obter_access_token_valido()` lê `public.bling_oauth`, renova se faltar <5 min pro
  `expires_at`, regrava, e cacheia em memória por processo (`_token_cache`).

### Rate limit

Bling documenta 3 req/s. Usamos `RateLimiter` (token global, 2 req/s) +
`ThreadPoolExecutor(max_workers=3)` só na busca de detalhe (que é o gargalo: 1 request
por pedido, sem endpoint de detalhe em lote). A listagem (`/pedidos/vendas`) é paginada
sequencialmente com até 100 registros por página.

**Atenção**: backfill histórico grande (muitos pedidos) pode passar de 15 min — rodar
localmente (`LOCAL_MODE=true`), em blocos, em vez de via Lambda. Lambda é mais adequado
pra sincronização incremental (últimos N dias).

## Tabelas Supabase

- `{schema}.pedidos_vendas` — PK `(id_pedido, id_item)`. RPC `processar_carga_pedidos_vendas`.
- `{schema}.pedidos_vendas_parcelas` — PK `(id_pedido, id_parcela)`. RPC
  `processar_carga_pedidos_vendas_parcelas`.
- `public.bling_oauth` — PK `conta`. Sem RPC; upsert direto via REST
  (`Prefer: resolution=merge-duplicates`).

Campos e schema dos objetos do Bling documentados em `sql/create_table_pedidos_vendas.sql`
e derivados diretamente do OpenAPI oficial (`VendasDadosBaseDTO`, `VendasDadosDTO`,
`VendasItemDTO`, `VendasParcelaDTO`, etc).

## Parâmetros do Evento

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| `cliente` | string | Sim | Chave em `LOCAL_CLIENT_CONFIGS` (ex.: `barbers`) |
| `data_inicial` | string | Não | Data inicial ISO (YYYY-MM-DD) |
| `data_final` | string | Não | Data final ISO (YYYY-MM-DD) |

> Sem `data_inicial`/`data_final`, o período padrão é os últimos 5 dias.

## Variáveis de Ambiente

Ver `.env.example`. Resumo:
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — sempre necessários (Supabase é onde ficam os
  tokens OAuth, não só o destino dos dados).
- `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_REDIRECT_URI` — credenciais do app Bling.
- `BLING_CONTA` — identificador da linha em `public.bling_oauth` (deve bater com
  `conta_bling` em `LOCAL_CLIENT_CONFIGS`, ou usa o próprio `cliente` como default).
- `LOCAL_MODE`, `LOCAL_CLIENT_CONFIGS`, `ETL_CLIENTE`, `ETL_DATA_INICIAL`,
  `ETL_DATA_FINAL` — execução local.
- `DISCORD_WEBHOOK_URL` — opcional.

## Configurações da Lambda (quando for deployar)

| Config | Valor |
|--------|-------|
| Runtime | Python 3.11 |
| Timeout | 15 minutos (ok pra incremental; backfill grande roda local) |
| Memória | 512-1024 MB |
| Variáveis de ambiente | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DISCORD_WEBHOOK_URL` |
