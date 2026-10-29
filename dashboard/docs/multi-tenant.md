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

## Fase 2 (canais, Bling e ETL por tenant)

- `sql/multi_tenant_fase2.sql`: `canais_integracoes.tenant_id` (backfill = barbers, DEFAULT temporário) e `meus_tenants()` devolvendo `conta_bling`. Depois do deploy: `ALTER TABLE public.canais_integracoes ALTER COLUMN tenant_id DROP DEFAULT;`.
- Dashboard: `autorizarCanais()` devolve o tenant; listar/criar/excluir/reconectar canal e os callbacks OAuth filtram por `tenant_id`; `lojaNuvemshop(tenantId, ...)`; `lib/bling.ts` recebe a conta (`contaBlingDoTenant(tenant)` = `tenants.conta_bling` ou o slug). `BLING_CONTA` (env) deixou de existir; `BLING_CLIENT_ID/SECRET` continuam um app só.
- ETL: o workflow `etl-hourly.yml` tem um job `tenants` (lê `public.tenants`) e roda o ETL inteiro em matriz, um por cliente (`fail-fast: false`). Disparo manual aceita `tenant` (slug); **vazio = todos os clientes**, então nos disparos de escrita informe o cliente. `LOCAL_CLIENT_CONFIGS` ganhou `tenant_id` (obrigatório nos ETLs Nuvemshop/Mercado Livre e nos scripts manuais que leem `canais_integracoes`).
- Novo cliente: `python3 scripts/gerar-sql-tenant.py <slug> <schema> "<Nome>" [conta_bling] > instalar.sql` e aplicar. Cria o schema, tabelas, views e triggers (sem os dados da Barbers) e cadastra o tenant. Depois: criar o usuário, associá-lo ao tenant, conectar o Bling (`bling_oauth_bootstrap.py` com `BLING_CONTA=<conta_bling>`) e os canais pela tela de Canais de Venda.

## Falta (fase 3)

- Nuvemshop/Mercado Livre: o app padrão é o da Barbers World (variáveis de ambiente / segredos do repositório). Um cliente com app próprio ganha uma linha em `public.canais_apps` (`dashboard/sql/canais_apps.sql`: tenant_id, plataforma `mercado-livre` ou `nuvemshop`, app_id, client_secret; só o service_role lê). O dashboard (conectar canal, trocar code) e o ETL do Mercado Livre (renovar token) usam a linha do cliente e, sem ela, o app global. O redirect continua sendo a URL do dashboard (`/api/canais-venda/<plataforma>/callback`), igual para todos, e deve estar cadastrada no app de cada cliente.

## Configuração do dashboard por cliente (`public.tenants.config`)

`sql/multi_tenant_config.sql` adiciona `tenants.config` (JSONB) e `meus_tenants()` passa a devolvê-la.
- `abas`: abas de canal do Dashboard (`{ id, label, grupo, situacoes_padrao? }`). `grupo` é o `canais_venda.grupo` do cliente; `situacoes_padrao` são ids de `situacoes_pedido` **dele** (os ids do Bling mudam por conta). A aba Geral sempre existe; sem `abas` só ela aparece.
- `status_lead`: classificações de lead usadas, em ordem. Ids do catálogo de `src/lib/leads-status.ts`; sem configuração valem `pendente`, `cliente`, `concorrente` e `lead`.
- Barbers recebe, na própria migração, a configuração que estava fixa no código. Exemplo para um cliente com Shopee pelo Bling:
  `UPDATE public.tenants SET config = '{"abas":[{"id":"shopee","label":"Shopee","grupo":"Shopee","situacoes_padrao":[9,6]}]}' WHERE slug = '<slug>';`

## Administrador do cliente (`tenant_users.is_admin`)

Quem é `is_admin` no cliente ativo vê a tela de Usuários e gerencia **só os membros daquele cliente**: cria (convite por email ou link), edita módulos, marca outro como administrador, gera novo acesso e exclui. O super admin da plataforma continua vendo e fazendo tudo, inclusive criar super admins.

Limites do administrador do cliente (aplicados em `lib/usuarios/exigir-admin.ts` e nas rotas de `/api/usuarios`): não vê nem altera super admins; não cria super admin; não altera o próprio papel de administrador; nome e ativo/inativo valem para a conta inteira, então só mexe neles se o usuário pertence apenas a este cliente (se também é de outro, só o super admin). Excluir um usuário que é de outro cliente só o remove deste.

O primeiro administrador de um cliente novo é marcado pelo super admin na tela de Usuários (checkbox "Administrador deste cliente") ou por `UPDATE public.tenant_users SET is_admin = true WHERE ...`.

## Bling: app próprio por cliente

Cada cliente cria o app dele no Bling (Central de Extensões, aplicativo próprio) com redirect `http://localhost:8080/callback`. As credenciais ficam em `public.bling_apps` (uma linha por `conta`, RLS sem política: só `service_role`); a conta sem linha usa `BLING_CLIENT_ID/SECRET` (Barbers). O ETL (`obter_credenciais_bling(cliente, conta)`) e o dashboard (`lib/bling.ts`) consultam a tabela na renovação do token.

Como cadastrar o Bling de um cliente novo: aplicar `etl-bling-pedidos-vendas/sql/create_table_bling_apps.sql` (uma vez) e, na pasta do ETL, com `.env` apontando para o app do cliente e `BLING_CONTA=<conta_bling do tenant>`, `BLING_APP_PROPRIO=1`, rodar `python bling_oauth_bootstrap.py` e autorizar com o login do Bling dele. Isso grava tokens e app.
- Marca por tenant além de nome/logo.
- Classificações de lead novas por cliente (hoje o cliente escolhe um subconjunto do catálogo de `leads-status.ts`).
- Gerador de SQL: o script de instalação foi executado no Supabase de produção dentro de uma transação desfeita (schema de teste `teste_cli`, 25 tabelas, view, trigger, índices): sem erro de DDL e sem resíduo. As tabelas de estoque e de vínculos por loja foram incluídas depois e ainda não rodaram. Não se criam GRANTs: o schema da Barbers também não tem; só as RPCs (SECURITY DEFINER) acessam os dados. Fica de fora de propósito o que é só da Barbers (`consultas_precos*`, `titulos_*`).
- `leads_mapeados.status`: o gerador cria o CHECK só com `pendente`, `cliente`, `concorrente` e `lead`. Para um cliente usar mais classificações, ampliar o CHECK dele e incluir os ids em `config.status_lead`.
