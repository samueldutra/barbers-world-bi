# CLAUDE.md

> Responder sempre em português do Brasil.

## O que é

ETL de **pedidos da Nuvemshop** (API v1) → Supabase (`barbers.nuvemshop_pedidos` e `nuvemshop_pedidos_itens`).
Complementa os pedidos que o Bling já traz (`pedidos_vendas`): frete pago pelo cliente e pela loja, cupom,
status de pagamento/envio, forma de pagamento/parcelas e cidade de entrega. Não substitui o Bling — o BI de
faturamento continua lendo de `pedidos_vendas`; juntar os dois é o próximo passo (conferir se
`nuvemshop_pedidos.numero` = `pedidos_vendas.numero_loja`).

## Comandos

```bash
pip install -r requirements.txt
cp .env.example .env   # preencher SUPABASE_URL / SUPABASE_SERVICE_KEY (service_role)
python etl-nuvemshop-pedidos.py
```

Roda também no GitHub Actions (último passo de `.github/workflows/etl-hourly.yml`, mesmos segredos do
repositório; **não precisa de segredo novo da Nuvemshop**).

## De onde vêm os tokens

Das lojas conectadas em **Canais de Venda** (dashboard) → `public.canais_integracoes`
(`plataforma='nuvemshop'`, `status='conectado'`). O token da Nuvemshop não expira, então não há refresh. Sem loja
conectada o ETL só avisa e termina com sucesso. Token recusado (401/403: app desinstalado) marca o canal como
`erro` (aparece com "Reconectar" no dashboard) e a execução falha no fim, depois de processar as outras lojas.
Para conectar: `dashboard/docs/integracao-nuvemshop.md`. O app precisa da permissão **read_orders**.

## Fluxo

1. `listar_lojas_conectadas()` → por loja, `listar_pedidos()` pagina `GET /v1/{store_id}/orders`
   (`updated_at_min`, `status=any`, `per_page=200`; os itens vêm dentro do pedido, sem chamada de detalhe).
2. `transformar_pedido()` → 1 linha de pedido + N de itens. 3. Dedup pela PK e upsert em lotes de 500 pelas RPCs
   `processar_carga_nuvemshop_pedidos(_itens)` (só `service_role`).

Janela: `ETL_ALTERADOS_HORAS` (padrão 24) — pedido novo também conta como alterado, então uma só janela cobre
novos e mudanças de status. **Backfill**: `ETL_DATA_INICIAL=AAAA-MM-DD` (ou Actions → Run workflow com
`alterados_horas` grande, ex.: 8760 = 1 ano). É idempotente.

## API da Nuvemshop — particularidades

- Header de autenticação é `Authentication: bearer <token>` (não `Authorization`) e o `User-Agent` é obrigatório.
- Limite: balde de 40 requisições, vaza 2/s → limitador de 1,5 req/s e espera pelo `x-rate-limit-reset` no 429.
- Lista vazia / página além da última volta como **404** (tratado como "sem mais pedidos").
- Valores monetários vêm como string (`"105.50"`); datas como `...+0000`.

## Banco

`sql/create_table_nuvemshop_pedidos.sql` e `sql/rpc_processar_carga_nuvemshop_pedidos.sql` (já aplicados em
09/10/2026). Chave: `(store_id, id_pedido)` e `(store_id, id_pedido, id_item)`. Sem tokens nem leitura pelo app
ainda — o schema `barbers` não é exposto no PostgREST; para mostrar no dashboard, criar RPCs de leitura.

## Pendências

- Nunca rodou contra uma loja real (a conexão ainda não foi autorizada): conferir campos reais do pedido na
  primeira execução (ex.: `closed_at`, `payment_details`, `shipping_cost_owner`) e o filtro `updated_at_min`.
- Webhooks (`order/created`, `order/updated`) para tempo quase real; hoje o ETL é por polling horário.
