# Integração com a Shopee (Open Platform v2)

Modelo multi-tenant: cada cliente usa o **app dele** (`public.canais_apps`, plataforma `shopee`: `app_id` = `partner_id`,
`client_secret` = `partner_key`); sem linha vale o app padrão (`SHOPEE_PARTNER_ID`/`SHOPEE_PARTNER_KEY`). Cada loja
autorizada é uma linha de `public.canais_integracoes` (`plataforma='shopee'`, `store_id` = `shop_id`).

## Como funciona

- Autorização: o lojista abre o link `https://open.shopee.com.br/auth?partner_id=…&auth_type=seller&redirect_uri=…&response_type=code&state=…`,
  entra com o login da **loja**, confirma o SMS e escolhe a validade (até **365 dias**). A Shopee volta em
  `{NEXT_PUBLIC_APP_URL}/api/canais-venda/shopee/callback?code=…&shop_id=…&state=…`.
- `code` vale 10 min e é de uso único → `POST /api/v2/auth/token/get`. `access_token` vale **4 h**; `refresh_token` **30 dias**
  e **cada renovação devolve um par novo** (o ETL grava antes de usar). Assinatura HMAC-SHA256 (ver `lib/canais-integracao/shopee.ts`).
- Vencida a autorização (365 dias no máximo, `canais_integracoes.autorizacao_expira_em`) ou recusado o refresh, o canal vira `erro`
  e o lojista precisa **Reconectar**.

## Passo a passo (cliente novo, ex.: Invento3d)

1. O cliente cria a conta de desenvolvedor em open.shopee.com e, em Console › App, um app **Seller In-House System**
   (vendedor com CNPJ; a categoria não muda depois). Guardar `partner_id` e `partner_key` do sandbox; testar na API Test Tool.
2. **Go Live:** Product Brief, **Live Redirect URL Domain** = domínio do dashboard (`NEXT_PUBLIC_APP_URL`) e IP whitelist.
   A `partner_key` de produção é outra.
3. Aplicar `dashboard/sql/alter_table_canais_integracoes_shopee.sql`; no schema do cliente, `etl-shopee-pedidos/sql/create_table_shopee_pedidos.sql`
   (trocando `barbers` pelo schema) e `rpc_processar_carga_shopee_pedidos.sql`. Clientes novos já recebem as tabelas pelo `scripts/gerar-sql-tenant.py`.
4. Cadastrar o app: o `INSERT … ON CONFLICT` comentado no fim do SQL do passo 3.
5. Em **Canais de Venda › Cadastrar canal › Shopee**, conectar e autorizar com o login da loja.
6. Rodar o ETL (Actions › Run workflow com `tenant`, ou local) com `alterados_horas` alto para o backfill; conferir `shopee_pedidos`.

## Pontos a confirmar na 1ª execução real

- Hosts: autorização `open.shopee.com.br` e API `openplatform.shopee.com.br` (sobrescrevem-se por `SHOPEE_AUTH_HOST`/`SHOPEE_API_HOST`;
  as amostras do guia usam `partner.shopeemobile.com`). Se o link exigir `sign`/`timestamp`, ajustar `urlAutorizacaoShopee`.
- Campos de `get_order_detail` (nomes, `ship_by_date`, `item_list`) e se `state` volta no redirect.
- **Dados sensíveis** (nome/endereço do comprador) vêm mascarados sem IP whitelist; GitHub Actions e Vercel não têm IP fixo.
- Comissão/taxas exigem `payment/get_escrow_detail` por pedido (não carregado ainda).
