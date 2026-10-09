# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Responder sempre em português do Brasil.

## Origem

Este projeto reaproveita a infraestrutura de autenticação (login, recuperação/redefinição de
senha, logout, proteção de rotas, rate limit) do **datapro-findash** (`~/datapro-findash`),
adaptada para o BI da Barbers World. Portado deliberadamente **sem** a parte multi-tenant
daquele projeto (troca de tenant, feature flags, gestão de "Contas") porque a Barbers World é um
tenant só por enquanto — adicionar de volta se um dia precisar atender mais de um cliente nesse
mesmo frontend. **Não há cadastro público**: contas só nascem pela tela de Usuários (super admin).

## Comandos

```bash
npm install
cp .env.local.example .env.local   # preencher (ver "Variáveis de ambiente")
npm run dev                         # http://localhost:3000
npx tsc --noEmit                    # tipos
npm run lint                        # eslint
npm run build                       # build de produção
```

Não há test runner ainda. O **CI** (`.github/workflows/ci.yml`) roda `tsc`, `eslint` e `build` em todo PR
que mexe no `dashboard/` (e no `main`); rode os três localmente antes de abrir o PR.

## Arquitetura

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 + shadcn/ui (preset `b2oDUijvc`, style
"radix-nova", base Radix; fonte IBM Plex Sans; reaplicar com
`npx shadcn@latest init --preset b2oDUijvc --base radix --template next --force`).
Mesmo projeto Supabase do ETL (`ajxmbhfmitehmxvjkcdk`), schema `barbers`. Os dados vêm de **RPCs**
(`supabase.rpc('...', { p_schema_name: TENANT_SCHEMA })`, ver `src/lib/tenant.ts`), nunca de tabelas
direto — o schema `barbers` não é exposto no PostgREST.

Deploy: Vercel, projeto `barbers-world-bi` (Root Directory `dashboard`), domínio `bw.findash.com.br`.

### Páginas e módulos de acesso

Layout da área logada: `src/app/(dashboard)/layout.tsx` → `AppShell` (sidebar `sidebar-08` inset +
cabeçalho com breadcrumb) dentro de `TooltipProvider` e `TvModeProvider`. Menu em `src/components/nav-items.tsx`.

| Rota | Módulo (`user_authorized_modules`) | O que é |
|---|---|---|
| `/dashboard` | `dashboard` | KPIs, evolução, vendas por canal, rankings; abas por canal; modo TV |
| `/relatorio-produtos` | `relatorio-produtos` | Vendas por produto + curva ABC por categoria; ao abrir um produto, painel com **comparação de preços** da concorrência |
| `/relatorio-clientes` | `relatorio-clientes` | Vendas por cliente + curva ABC |
| `/conferencia-precos` | `conferencia-precos` | Preço de cadastro no Bling × preço cheio da última venda nos canais de referência; altera o preço no Bling |
| `/prospeccao/mapeamento`, `/prospeccao/rotas/**` | `prospeccao` | Mapeia barbearias (Google Places) e monta rotas de visita |
| `/usuarios` | — (só super admin) | Cria usuários e libera módulos |
| `/sem-acesso` | — | Destino de quem não tem nenhum módulo |

A lista de módulos está em `src/types/modules.ts` (`SYSTEM_MODULES`). Os rótulos do menu
(`nav-items.tsx`) e os de `modules.ts` podem divergir (o menu usa "Produtos" e "Clientes").

### Autenticação e acesso

- `src/proxy.ts` — entrypoint do middleware (Next 16 renomeou `middleware.ts` → `proxy.ts`). Aplica CSRF
  (Origin × Host em métodos mutantes), rate limit em memória (`src/lib/security/rate-limit.ts`) e delega a
  sessão pra `updateSession`.
- `src/lib/supabase/middleware.ts` (`updateSession`) — refresca a sessão, manda quem não tem sessão pro
  `/login`, derruba conta desativada (`is_active = false`), restringe `/usuarios` a super admin e as páginas aos
  módulos liberados. **Rotas `/api/*` não passam pela checagem de módulo**: cada rota confere o que precisa
  (`exigirSuperAdmin()` em `/api/usuarios/**`; `usuarioPodeProspectar()` em `/api/prospeccao/**`).
  `/api/prospeccao/cidades/continuar` é aberta ao proxy de propósito (chamada servidor→servidor, protegida
  pelo token do mapeamento).
- `src/lib/supabase/{client,server,admin}.ts` — browser, server (cookies do usuário) e admin (`service_role`).
  O admin **bypassa RLS e as permissões das funções**: só em rotas de API server-side.
- Páginas públicas em `src/app/(auth)/`: `login`, `recuperar-senha`, `redefinir-senha` (layout força tema claro
  via `auth-light`). `src/app/api/auth/{callback,recovery,recuperar-senha}` tratam os links do Supabase.
- Logout e menu do usuário: `src/components/nav-user.tsx`.

### Perfil e permissões

Sem papéis. `public.user_profiles` (`sql/create_table_user_profiles.sql`) tem `is_superadmin` (acesso total) e
`is_active`; os módulos de cada usuário ficam em `public.user_authorized_modules` (`sql/user_modulos_acesso.sql`).
**O primeiro super admin é promovido manualmente**:
`UPDATE public.user_profiles SET is_superadmin = true WHERE id = '<uuid>';`
Hooks: `use-profile.ts`, `use-authorized-modules.ts`, `use-user.ts`.

### Banco (SQL em `sql/`)

Aplicar no SQL Editor do Supabase (ou pelo MCP). Cada tela tem o seu arquivo de RPCs:
`rpc_dashboard_vendas.sql` (padrão de situações, KPIs, canais), `rpc_dashboard_produtos.sql`,
`rpc_relatorio_produtos.sql`, `rpc_relatorio_clientes.sql`, `rpc_conferencia_precos.sql`, `rpc_comparacao_precos.sql`,
`rpc_prospeccao_leads.sql`, `rpc_prospeccao_rotas.sql`, `rpc_prospeccao_cidades.sql`.

**Segurança das funções** (`seguranca_revogar_acesso_publico.sql`, aplicado em 09/10/2026): as funções
`SECURITY DEFINER` do `public` **não** podem ser executáveis por `anon`/`PUBLIC` (a chave anon é pública). Toda
função nova deve terminar com `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon;` + `GRANT EXECUTE ... TO authenticated`
(chamada pelo app) ou só `service_role` (ETL, rotas de API que usam o cliente admin). Conferir com
`has_function_privilege('anon', oid, 'execute')`.

### Dashboard

- **Abas por canal** (`src/lib/abas-canais.ts`): Geral + Loja Física, Nuvemshop, Mercado Livre, Shopee, TikTok Shop.
  Nas abas de canal o filtro de canais é fixado no **grupo** do canal (`canais_venda.grupo`) e fica bloqueado; só
  período e situação mudam. Cada aba pode ter um **padrão de situações** próprio (`situacoesPadrao`); hoje os canais
  online usam Atendido, P/ Separação, Verificado e Em aberto.
- **Padrão de situações**: Geral = `situacoes_padrao_dashboard(schema)` (todas menos Cancelado, Em aberto e as que
  herdam de Em aberto). Os relatórios de produtos/clientes e a conferência de preços usam só
  `situacoes_validas_faturamento()` (Atendido). Ver `CLAUDE.md` da raiz.
- **Modo TV** (`src/contexts/tv-mode-context.tsx`): tela cheia, sidebar escondida (aparece ao encostar o mouse na
  borda esquerda), interface escalada pela largura (Full HD/2K/4K via `html.tv-mode` em `globals.css`), tela sempre
  acesa e atualização automática.
- **Atualização automática** a cada 10 min em Dashboard, Produtos e Clientes (`refreshToken` nos hooks, recarga
  silenciosa; sem botão "Atualizar"). Lembre que o ETL só traz dado novo algumas vezes por dia.

### Filtros (Dashboard, Produtos e Clientes)

Padrão único: no topo, **Período** + botão **Filtrar** (com o número de filtros aplicados) que abre o drawer
"Filtros" (`src/components/filtros/filtros-drawer-base.tsx`: voltar, campos, Aplicar e Cancelar, sempre num
rascunho). Cada tela monta os seus campos (`dashboard/filtros-drawer.tsx`,
`relatorio-produtos/filtros-produtos-drawer.tsx`, `relatorio-clientes/filtros-clientes-drawer.tsx`).

### Cores

Padrão único de cores (sem tema claro/escuro): a moldura — sidebar e fundo da página — é preta (`--sidebar`) com
texto e ícones brancos; o conteúdo fica no cartão branco (`SidebarInset`). Tokens em `src/app/globals.css`. Não há
`ThemeProvider` nem classe `.dark` (o `@custom-variant dark` fica só pra manter as variantes `dark:` dos
componentes shadcn inertes).

### Comparação de preços com a concorrência (piloto)

Em `/relatorio-produtos`, clicar numa linha abre o painel do produto (`produto-detalhe-sheet.tsx`); a aba
**Comparar preços** chama `POST /api/produtos/comparar-precos`, que busca o produto no **Google Shopping Brasil via
SerpApi** (`src/lib/comparar-precos/`) e lista ofertas de outras lojas (preço, diferença para o nosso, link). A nossa
loja é filtrada. O texto da busca (nome do produto) pode ser refinado, e há botão para buscar pelo **EAN** quando o
campo `codigo` do Bling é um EAN.
- **Custo controlado:** cada busca é paga. Cache de 24 h por produto (reabrir não gasta), teto diário de 100 buscas
  (`COMPARAR_PRECOS_LIMITE_DIA`), acesso só com o módulo Produtos. Consultas e resultados ficam em
  `barbers.consultas_precos(_itens)` (histórico de preços da concorrência).
- Precisa de `SERPAPI_API_KEY` no servidor; sem ela a aba avisa que não está configurada.
- O Google traz resultados parecidos que não são o mesmo produto: a tela pede conferir modelo/tamanho/kit.

### Prospecção: cidades do Brasil e mapeamento automático

- `barbers.cidades` guarda os 5.571 municípios do IBGE (nome, UF, estado); em Rotas > Nova rota > "Gerar por
  cidade" dá pra escolher qualquer uma (`buscar_cidades`). `leads_mapeados.uf` + `cidade` identificam o município.
- Cidade sem leads (ou com "completar mapeamento" marcado): `POST /api/prospeccao/cidades/mapear` (exige o módulo
  de Prospecção) cria a rota em `mapeando` e busca TODAS as barbearias no Google Places em segundo plano
  (`src/lib/prospeccao/mapeamento-cidade.ts`: quadtree de retângulos buscados pelo círculo que os circunscreve;
  subdivide onde a busca volta com 20). O processamento usa `after()` e se encadeia por `/continuar` (token do
  mapeamento) a cada ~40 s; `/retomar` religa mapeamentos parados. Ao terminar a rota ganha as paradas (ordem do
  vizinho mais próximo) e vira `planejada`.
- Teto de 500 buscas por cidade (`MAX_CIRCULOS_POR_CIDADE`, ~US$ 0,035 por busca) — cidades enormes terminam
  "parciais" (avisado na rota). Só mapeamento completo marca a cidade como `mapeada_em`.
- O link do Google Maps de uma rota leva só as próximas 23 paradas não visitadas (limite do Maps).
- Fila e progresso em `barbers.cidades_mapeamento`.

### Prospecção: classificações e favoritos

- Status do lead (`leads_mapeados.status`, CHECK no banco): `pendente` (A classificar), `cliente`, `concorrente`, `lead`,
  `cliente_bw`, `cliente_anderson`, `cliente_leo`. Rótulos, cores do mapa e estilo dos botões ficam num lugar só:
  `src/lib/leads-status.ts` (para criar uma nova classificação: CHECK + as 2 RPCs de status no SQL + esse arquivo + o tipo
  `StatusLead` em `use-leads-mapeados.ts`).
- Favorito (`leads_mapeados.favorito`, estrela): RPC `favoritar_lead_mapeado`; aparece na lista de leads (com filtro
  "Favoritos"), no detalhe do lead, na seleção de paradas de Nova rota e nas paradas de cada rota. O favorito é do
  lead, então vale em todas as rotas.

## Variáveis de ambiente (`.env.local` e Vercel)

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente Supabase (browser e server). A anon é pública. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Precisa ser a chave com papel `service_role`** (confira o papel dentro do JWT; já houve a `anon` aqui). Usada em `/api/usuarios/**`, mapeamento de cidades, etc. |
| `GOOGLE_PLACES_API_KEY` | Busca de barbearias (server). Restrinja à Places API (New). |
| `SERPAPI_API_KEY`, `COMPARAR_PRECOS_LIMITE_DIA` | Comparação de preços (Google Shopping via SerpApi). A segunda é o teto diário de buscas (padrão 100). |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Mapa no navegador (Maps JavaScript API, restrita por HTTP referrer). |
| `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_CONTA` | Conferência de Preços altera preço no Bling; tokens OAuth em `public.bling_oauth`. |

Nunca commitar valores reais (o `.env.local.example` só tem os nomes).

## Pendências conhecidas

- Sem tipos gerados do banco (`database.types.ts`) — os clientes Supabase não são tipados por schema. Gerar com
  `supabase gen types typescript` quando o MCP do Supabase estiver autorizado.
- Sem testes automatizados (só o CI de tipos/lint/build).
- Os dados de leads e rotas são acessíveis, via RPC, a qualquer usuário logado: o banco não confere módulo (só as
  rotas de API que gastam com o Google conferem).
- `exceljs` → `uuid`: 2 vulnerabilidades moderadas em dependência de produção que só se resolvem com mudança de
  versão que quebra compatibilidade (risco baixo).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
