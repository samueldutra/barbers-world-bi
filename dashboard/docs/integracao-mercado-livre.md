# Integração com o Mercado Livre — passo a passo

Módulo **Canais de Venda** (`/canais-venda`). Hoje ele **conecta** a conta do vendedor (OAuth 2.0) e guarda os
tokens com segurança; a leitura de pedidos para o BI é a etapa seguinte (ver "Próximos passos").

## O que é preciso

| Item | Onde | Observação |
|---|---|---|
| App da Barbers World no Mercado Livre | DevCenter (<https://developers.mercadolivre.com.br/devcenter>) → Criar aplicativo | Gera **App ID** e **Secret Key** |
| `MERCADOLIVRE_APP_ID` / `MERCADOLIVRE_CLIENT_SECRET` | Vercel (Environment Variables) | Server-side; segredo nunca no git |
| `NEXT_PUBLIC_APP_URL` | Vercel | `https://bw.findash.com.br` (sem barra no final) |
| Colunas novas em `public.canais_integracoes` | SQL Editor do Supabase | Rodar `sql/alter_table_canais_integracoes_mercado_livre.sql` (depois de `create_table_canais_integracoes.sql`) |

## Criar o app (uma vez)

1. No DevCenter, **Criar aplicativo**. **Redirect URI:** `https://bw.findash.com.br/api/canais-venda/mercado-livre/callback`
   (idêntica e estática; o Mercado Livre rejeita qualquer diferença).
2. Permissões: leitura (**read**) de Usuários, Pedidos/Vendas e Envios; marque **offline_access** (refresh token).
   Só peça escrita se for alterar algo no Mercado Livre.
3. Copie App ID e Secret Key para a Vercel e faça redeploy.

## Conectar

**Canais de Venda → Cadastrar canal → Mercado Livre** → dar um nome → **Conectar**. Entre com a conta **principal**
do vendedor (colaborador/operador recebe `invalid_operator_user_id`) e clique em **Permitir**.

## Por baixo

- `access_token` vale **6 h**; `refresh_token` é de **uso único** (cada renovação devolve um novo — persistir sempre
  o último) e vale ~6 meses. Ficam em `public.canais_integracoes` (`refresh_token`, `token_expira_em`), só `service_role`.
- Troca de token: `POST https://api.mercadolibre.com/oauth/token` (form-urlencoded). Chamadas: `Authorization: Bearer`.
- `store_id` = `user_id` do vendedor; nome/link vêm de `GET /users/me`.
- Se o app tiver **PKCE** habilitado no DevCenter, o fluxo atual não funciona (exige `code_challenge`): deixe desligado.

## Próximos passos

1. ETL de pedidos (`GET /orders/search?seller={id}&order.date_last_updated.from=...`, `offset`/`limit` ≤ 51), com
   renovação do token antes de cada rodada (como `public.bling_oauth`), em `etl-mercadolivre-pedidos/`.
2. Webhooks (tópico `orders_v2`) para atualização em tempo quase real.
3. Conciliar com `barbers.canais_venda` (grupo "Mercado Livre") para a aba do Dashboard.
