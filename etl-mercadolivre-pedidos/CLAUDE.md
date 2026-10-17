# CLAUDE.md

> Responder sempre em português do Brasil.

## O que é

ETL de **pedidos do Mercado Livre** (`/orders/search`) → Supabase (`barbers.mercadolivre_pedidos` e
`mercadolivre_pedidos_itens`). Mesmo desenho do `etl-nuvemshop-pedidos/`. O Bling já traz os pedidos do ML em
`pedidos_vendas`; este ETL complementa com comissão, forma de pagamento/parcelas, pack (carrinho), tags e SKU do
anúncio. Juntar com o Bling (por número do pedido do canal) é um passo futuro.

## Comandos

```bash
pip install -r requirements.txt
cp .env.example .env   # SUPABASE_URL / SUPABASE_SERVICE_KEY (service_role) / MERCADOLIVRE_APP_ID / MERCADOLIVRE_CLIENT_SECRET
python etl-mercadolivre-pedidos.py
```

Roda também no GitHub Actions (passo "Mercado Livre" de `.github/workflows/etl-hourly.yml`). **Precisa de dois
segredos novos no repositório:** `MERCADOLIVRE_APP_ID` e `MERCADOLIVRE_CLIENT_SECRET` (os mesmos da Vercel), para
renovar o token.

## Tokens

Contas conectadas em **Canais de Venda** → `public.canais_integracoes` (`plataforma='mercado-livre'`). O
`access_token` vale 6 h; o `refresh_token` é de **uso único**. `renovar_token()` roda quando faltam < 15 min e grava o
novo par no banco **antes** de usar. `invalid_grant`/401 após renovar → canal vira `erro` (botão Reconectar) e a
execução falha no fim, depois das outras contas. Evite rodar duas execuções ao mesmo tempo (as duas gastariam o
mesmo refresh_token): o workflow é horário e curto, mas não dispare manual junto do agendado.
Guia: `dashboard/docs/integracao-mercado-livre.md`; o app precisa ler Pedidos/Vendas.

## Fluxo

`listar_pedidos()` pagina `GET /orders/search?seller=...&order.date_last_updated.from=...&sort=date_asc`
(`limit=50`, `offset`) → `transformar_pedido()` (1 pedido + N itens) → dedup pela PK → upsert em lotes de 500 pelas RPCs
`processar_carga_mercadolivre_pedidos(_itens)` (só `service_role`). Janela `ETL_ALTERADOS_HORAS` (padrão 24);
backfill com `ETL_DATA_INICIAL` ou Actions → Run workflow com `alterados_horas` alto. Idempotente. O ML só guarda
pedidos de ~12 meses.

## Banco

`sql/create_table_mercadolivre_pedidos.sql` e `sql/rpc_processar_carga_mercadolivre_pedidos.sql` — **ainda não
aplicados** (rodar no SQL Editor/MCP antes da primeira execução, junto com
`dashboard/sql/alter_table_canais_integracoes_mercado_livre.sql`). Chaves: `(seller_id, id_pedido)` e
`(seller_id, id_pedido, seq)`.

## Pendências / a conferir na 1ª execução real

- Nunca rodou contra uma conta real. Conferir: se `sale_fee` é por unidade (a comissão do pedido multiplica por
  quantidade), `marketplace_fee` nos pagamentos, `seller_sku` vs `seller_custom_field`, e se `buyer.nickname` vem.
- Frete: só o `frete_id` é guardado; custo/endereço exigem `/shipments/{id}` (1 chamada por pedido).
- Cancelados: a busca como vendedor pode omitir pedidos cancelados; checar se isso importa para o BI.
- Webhooks (`orders_v2`) para tempo quase real.
