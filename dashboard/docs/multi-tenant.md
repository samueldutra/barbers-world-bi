# Multi-tenant: um schema por cliente

Fase 1 (isolamento no banco + tenant ativo no app). **Ainda não dá para cadastrar o segundo cliente** — ver "Falta (fase 2)".

## Como funciona

- `public.tenants` (slug, nome, `schema_name`, `conta_bling`, logo) e `public.tenant_users` (usuário × tenant).
- `user_authorized_modules` passou a ser por `(user_id, tenant_id, module)`. `is_superadmin` continua global (vê todos os tenants).
- **Toda RPC que recebe `p_schema_name` chama `public.assert_tenant_access(p_schema_name)` no início.** Passa: service_role (ETL e rotas de API), dono do banco e usuário ativo que é super admin ou membro do tenant. O schema também precisa estar em `public.tenants` (ativo), o que barra nomes malformados antes do `format(%I)`.
- Tenant ativo: cookie `tenant` (slug, `httpOnly`), **revalidado em toda requisição** contra `public.meus_tenants()`. Sem cookie válido, usa o primeiro tenant do usuário.
  - Servidor: `tenantAtivoDaRequisicao(supabase)` (`lib/tenant-server.ts`); no proxy, `resolverTenantAtivo` (`lib/tenant-resolver.ts`).
  - Rotas de API: `autorizarModulo(modulo, msg)` devolve `{ erro, user, tenant }`; use `tenant.schema_name` em `p_schema_name`.
  - Navegador: `TenantProvider` (layout de `(dashboard)`) + `tenantSchema()` (`lib/tenant.ts`) nos hooks. Trocar de tenant (`POST /api/tenant`) recarrega a página.
- O mapeamento de cidades em segundo plano carrega o `schema` na cadeia `/continuar`; o token do job continua sendo a autorização.

## Ordem de aplicação (produção)

1. `sql/multi_tenant.sql` — cria o tenant `barbers`, associa todos os usuários e módulos atuais a ele. Seguro com o frontend antigo no ar (`tenant_id` tem DEFAULT = barbers).
2. Reaplicar os `sql/rpc_*.sql` (agora com a checagem) — o frontend antigo continua funcionando, pois os usuários são membros do `barbers`.
3. Deploy do frontend.
4. `ALTER TABLE public.user_authorized_modules ALTER COLUMN tenant_id DROP DEFAULT;`

Conferir depois: com um usuário comum do tenant A, `rpc('obter_kpis_vendas', { p_schema_name: '<schema do B>' })` deve falhar com "Acesso negado ao tenant".

## Falta (fase 2) — bloqueia o segundo cliente

- `public.canais_integracoes` (tokens Nuvemshop/Mercado Livre) não tem `tenant_id`: `lojaNuvemshop()`, `/api/canais-venda/**` e os ETLs `etl-nuvemshop-*`/`etl-mercadolivre-*` leem todas as lojas, de qualquer cliente. Adicionar `tenant_id` e filtrar nesses pontos.
- `lib/bling.ts` usa `BLING_CONTA` (env). Trocar por `tenants.conta_bling` do tenant ativo.
- ETL: ler a lista de tenants de `public.tenants` (em vez de `LOCAL_CLIENT_CONFIGS`) e rodar um tenant por vez (ou matriz no GitHub Actions); `bling_oauth_bootstrap.py` por tenant.
- Instalação de um schema novo: hoje os SQL de tabelas têm `barbers` escrito. Parametrizar (ou `criar_tenant(slug)`).
- Marca por tenant além de nome/logo; `abas-canais.ts` e `leads-status.ts` (status por vendedor da Barbers) por tenant.
- Tela de Usuários só para super admin da plataforma; falta `tenant_users.is_admin` gerindo os próprios usuários.
- Fuso, `NEXT_PUBLIC_APP_URL` e callbacks OAuth continuam únicos (um domínio para todos os clientes).
