# CLAUDE.md

> Responder sempre em português do Brasil.

ETL de **pedidos da Shopee** (Open Platform v2: `order/get_order_list` + `order/get_order_detail`) → `shopee_pedidos` e
`shopee_pedidos_itens` no schema do tenant. Mesmo desenho do `etl-mercadolivre-pedidos/`. Guia completo (app, Go Live,
autorização, pendências): `dashboard/docs/integracao-shopee.md`.

- Lojas: `public.canais_integracoes` (`plataforma='shopee'`, `store_id` = shop_id). App: `public.canais_apps` do tenant
  (`app_id` = partner_id, `client_secret` = partner_key) ou `SHOPEE_PARTNER_ID`/`SHOPEE_PARTNER_KEY` (segredos do repositório).
- Tokens: access 4 h; refresh 30 dias, **renovação devolve par novo** (gravado antes de usar). Recusa do refresh → canal `erro`.
- Janela `ETL_ALTERADOS_HORAS` (24) ou `ETL_DATA_INICIAL`; a busca é fatiada em janelas de 15 dias (limite da API).
- Host da API: `SHOPEE_API_HOST` (padrão `https://openplatform.shopee.com.br`) — confirmar na 1ª execução.
- SQL **ainda não aplicado**; nunca rodou contra loja real. Não rode duas execuções ao mesmo tempo (o refresh troca o par).
