# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Responder sempre em português do Brasil.

## Estado atual

Repositório Git no GitHub (`samueldutra/barbers-world-bi`), `main` com deploy na Vercel. **CI** de código em
`.github/workflows/ci.yml` (tsc, eslint, build do `dashboard/`) e **ETL** agendado em
`.github/workflows/etl-hourly.yml` (nominalmente de hora em hora; na prática o GitHub dispara algumas vezes
por dia). Não há runner de testes automatizado ainda.

Objetivo: BI da **Barbers World**. Em produção:
- ✅ ETL de pedidos de venda do Bling → `barbers.pedidos_vendas` / `pedidos_vendas_parcelas`
  (`etl-bling-pedidos-vendas/`), mais clientes, produtos, canais e situações (scripts `sync-*`).
- ✅ Dimensões `barbers.canais_venda`, `contatos`, `produtos` e `situacoes_pedido`, sincronizadas pelo mesmo workflow.
  **Filtro padrão de situações** (o que conta como venda): `situacoes_validas_faturamento()` em
  `dashboard/sql/rpc_dashboard_vendas.sql` (hoje só `9 = Atendido`) vale para os relatórios (produtos/clientes) e a
  conferência de preços. **Exceção — Dashboard:** as RPCs recebem `p_situacoes BIGINT[]` e, quando é `NULL`, caem em
  `situacoes_padrao_dashboard(schema)` = todas as situações menos Cancelado (12), Em aberto (6) e as que herdam de Em
  aberto (inclui Devolução). Cada aba de canal do Dashboard pode ter padrão próprio (`dashboard/src/lib/abas-canais.ts`).
- ✅ Frontend (`dashboard/`, Next.js 16): login por convite, módulos por usuário, Dashboard (abas por canal e modo
  TV), relatórios de produtos e clientes, conferência de preços, prospecção de leads e rotas (com mapeamento
  automático de cidades) e gestão de usuários. Detalhes em `dashboard/CLAUDE.md`.
- ⚠️ Dados do BI só são tão frescos quanto o ETL; o dashboard recarrega a cada 10 min, mas o ETL roda algumas
  vezes por dia.

## Arquitetura (3 camadas)

O projeto replica o pipeline já usado em `~/Devingá/repo/etl-faturamento` (extração) e
`~/datapro-findash` (BI/frontend):

1. **Extração — AWS Lambda ETL (Python 3.11)**
   - Um script por entidade: `etl-bling-pedidos-vendas`, `etl-bling-produtos`,
     `etl-bling-contas-receber`, `etl-bling-contas-pagar`, `etl-bling-nfe`, etc.
   - Consome a API do Bling → transforma/denormaliza → chama uma RPC do Supabase que faz `upsert`.
   - Notifica o resultado de cada execução no Discord.
   - Hoje roda **no GitHub Actions** (`etl-hourly.yml`, `LOCAL_MODE=true`, segredos do **repositório**
     — ver `etl-bling-pedidos-vendas/CLAUDE.md`); também roda local (`.env`) ou, no futuro, na AWS (SSM).
     A chave `SUPABASE_SERVICE_KEY` **precisa ser a `service_role`**: as RPCs `processar_carga_*` só aceitam essa chave.
2. **Armazenamento — Supabase (Postgres)**
   - Isolamento **por schema** (um schema por tenant). Barbers World = um schema dedicado
     (definir o nome; ex.: `barbers`). O schema `public` guarda só configuração.
   - Toda RPC recebe `p_schema_name` (ou `p_schema`) e faz o upsert dinâmico no schema alvo.
   - Schemas novos precisam ser adicionados em **Settings → API → Exposed schemas** no
     dashboard do Supabase (erro `PGRST106` = schema não exposto).
3. **BI / Frontend — `dashboard/` — Next.js 16 (App Router) + React 19 + TypeScript**
   - Autenticação/logout/permissões (`superadmin`/`admin`/`user`/`viewer`) reaproveitados do
     `~/datapro-findash`, **sem** a parte multi-tenant/multi-módulo daquele projeto (troca de
     tenant, feature flags, `SYSTEM_MODULES`) — a Barbers World é um tenant só por enquanto.
     Detalhes em `dashboard/CLAUDE.md`.
   - Dados vêm do schema `barbers` via RPC (mesmo padrão `p_schema` do datapro-findash).

## Padrões OBRIGATÓRIOS do ETL

Referência canônica: `~/Devingá/repo/etl-faturamento/LAMBDA_ETL_TEMPLATE.md` (ler antes de
criar qualquer Lambda). Também existe o agente `lambda-etl-creator` e a skill
`criar-lambda-etl` para gerar o esqueleto completo.

Estrutura de cada ETL:

```
etl-bling-{entidade}/
├── etl-bling-{entidade}.py     # Lambda + toda a lógica
├── requirements.txt            # requests, python-dotenv (+ boto3 na AWS)
├── test_event.json             # evento de exemplo
├── .env.example                # template de variáveis locais
├── CLAUDE.md                   # doc do ETL
└── sql/
    ├── create_table_{entidade}.sql
    └── rpc_processar_carga_{entidade}.sql
```

Regras que não mudam:
- `log()` com timestamp `[YYYY-MM-DD HH:MM:SS]`.
- `get_http_session()` com `Retry(total=5, backoff_factor=0.5, status_forcelist=[429,500,502,503,504])`.
- `rpc_supabase_com_retry()` com backoff exponencial, `timeout=120`, controlado por `rpc_semaphore`.
- Carga em **lotes de 500 registros**; **remover duplicatas** pela chave primária antes de enviar.
- Preferir **RPC de upsert** em vez de REST direto na tabela.
- `DiscordLogger.log_execution()` no `finally` do handler (sucesso e falha).
- Suporte a execução local: `LOCAL_MODE`, `LocalContext`, parâmetros via `ETL_*` no `.env`.
- Credenciais: **nunca** hardcode. Local = `.env` (fora do controle de versão); AWS = SSM Parameter Store.

## Especificidades da API do Bling (v3) — diferenças em relação ao template

O template foi escrito para o ERP SG Sistemas (login → Bearer simples). O Bling é diferente:

| Item | Bling v3 |
|------|----------|
| Base URL | `https://api.bling.com.br/Api/v3` |
| Autenticação | **OAuth 2.0** `authorization_code` (uma vez, no navegador) → `access_token` + `refresh_token` |
| TTL do `access_token` | ~6 horas → precisa renovar via `refresh_token` (grant `refresh_token`) |
| TTL do `refresh_token` | ~30 dias (rota-se a cada refresh) |
| Rate limit | **3 req/s** e **120.000 req/dia** → `api_semaphore = Semaphore(1)` + delay ≥ 0.34s |
| Paginação | `?pagina=N&limite=100` (limite máx. 100 na maioria dos endpoints) |
| Filtro de data | por endpoint (`dataInicial`/`dataFinal`, `dataEmissaoInicial`, etc.) — verificar na doc |

Implicação de arquitetura: o `refresh_token` **precisa ser persistido e atualizado** a cada
renovação (não cabe só no `.env`). **Decisão:** fonte de verdade é a tabela
`public.bling_oauth` no Supabase (1 linha por conta Bling). Funciona igual local e na
Lambda, sem depender de AWS SSM. O `.env` guarda só `client_id`/`client_secret`/`redirect_uri`.
- Autorização inicial (uma vez, no navegador): `etl-bling-pedidos-vendas/bling_oauth_bootstrap.py`.
- O ETL lê os tokens da tabela, dá refresh quando `expires_at` está perto e regrava.

Sempre confirmar contrato de endpoint/campos na doc oficial antes de codar:
`https://developer.bling.com.br/referencia` (ou via MCP context7).

Endpoints prováveis para o BI: `/pedidos/vendas`, `/produtos`, `/estoques/saldos`,
`/contas/receber`, `/contas/pagar`, `/nfe`, `/contatos`, `/categorias/receitas-despesas`,
`/formas-pagamentos`.

## Comandos

```bash
# ETL (dentro de etl-bling-pedidos-vendas/) — execução local, requer .env com LOCAL_MODE=true
pip install -r requirements.txt
python etl-bling-pedidos-vendas.py

# Frontend (dentro de dashboard/) — ver dashboard/CLAUDE.md
npm install && npm run dev
npx tsc --noEmit && npm run lint && npm run build   # o que o CI roda em todo PR
```

Não há framework de testes. ETL: rodar local com `test_event.json` (ou Actions → Run workflow), conferir os logs
e os registros no Supabase. Frontend: o CI de tipos/lint/build e a conferência manual no preview da Vercel.

## Supabase

- Organização e projeto novos. **Project ref:** `ajxmbhfmitehmxvjkcdk`
  (`SUPABASE_URL=https://ajxmbhfmitehmxvjkcdk.supabase.co`).
- Schema do tenant Barbers World: `barbers` (adicionar em Settings → API → Exposed schemas).
- MCP server `supabase` (escopo project) — config:
  `claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp?project_ref=ajxmbhfmitehmxvjkcdk&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching"`
  Depois autorizar com `claude /mcp` (terminal normal, não IDE). Sem isso, aplicar DDL/RPC
  pelo SQL Editor do dashboard.
- Skills opcionais: `npx skills add supabase/agent-skills`.

## Configuração de outros agentes

Existem configs de OpenAI Codex (`~/.codex/config.toml`) e Gemini CLI (`~/.gemini/`,
`GEMINI.md`). Para importar MCP servers / comandos / skills desses agentes para o Claude
Code, responder `/import` (e depois `/import --yes=<digest>`).
