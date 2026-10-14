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
   Se `alterados_horas` (evento) / `ETL_ALTERADOS_HORAS` (env) for informado, também lista
   `GET /pedidos/vendas?dataAlteracaoInicial=…&dataAlteracaoFinal=…` (horário de Brasília)
   e recarrega os pedidos **alterados** nas últimas N horas que ficaram fora do período —
   sem isso, mudança de situação em pedido antigo nunca chega ao BI. O workflow horário usa
   24h; pra forçar atualização maior, Actions → Run workflow com `alterados_horas` (ex.: 720).
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
- `{schema}.produtos.imagem_url` — link **permanente** do Supabase Storage (bucket público
  `produtos-imagens`, `sql/create_bucket_produtos_imagens.sql`). O Bling devolve `imagemURL`
  como link assinado do S3 que vence em ~30 min; `sync-produtos-bling.py` copia cada imagem
  pro bucket (uma vez — nome `{id_produto}-{id da imagem no S3}`, só recopia se mudar) e
  grava o link público. Se o Storage falhar, grava o link do Bling e o dashboard mostra o
  ícone de "sem imagem" quando ele vencer.
- `{schema}.canais_venda` — `descricao` é o nome exibido no BI = `nome_exibicao` (renome
  feito só no BI, não no Bling) ou, se vazio, o nome do Bling (`descricao_bling`).
  `processar_carga_canais_venda` mantém essa regra a cada sync. Renomes atuais e como
  renomear outro canal: `sql/canais_venda_nome_exibicao.sql`.
- `{schema}.canais_venda_de_para` — PK `id_loja_origem`. Junta num canal só os pedidos de
  uma integração do Bling excluída e recriada (novo `loja.id`). Aplicado por trigger
  (`trg_pedidos_vendas_de_para_canal`) em `pedidos_vendas`, então vale pra toda carga.
  Hoje: Nuvemshop `205291049 → 206304549` (recriada em 21/09/2026). Nova junção = inserir
  a linha + rodar o UPDATE de backfill de `sql/create_table_canais_venda_de_para.sql`.
  `sync-canais-venda-bling.py` roda no workflow horário.
- `{schema}.situacoes_pedido` — PK `id_situacao`. RPC `processar_carga_situacoes_pedido`.
  Sync sob demanda: `python sync-situacoes-bling.py` (GET `/situacoes/modulos/{idModulo}`;
  módulo de vendas via `BLING_ID_MODULO_VENDAS`, padrão `98310`). Rodar de novo sempre
  que uma situação for criada/renomeada no Bling.
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

## Vínculo produto x loja e estoque Bling -> Nuvemshop (execução manual)

Scripts de **disparo manual** (Actions → Run workflow em `etl-hourly.yml`, sempre com `apenas_nuvemshop` marcado; nos agendamentos nada
disso roda). **Regras de negócio** (decisão do usuário, 13/10/2026): o **SKU do Bling** pareia produto e variante e o **saldo do Bling**
é a verdade do estoque; os **preços (cadastro do Bling e loja) divergem de propósito e NUNCA são alterados** — o vínculo só grava o ID, e o
preço do vínculo espelha o que a loja já pratica (`preco` = preço da Nuvemshop, `precoPromocional` = promoção da loja ou 0).

O "ID na loja" (`codigo` em `GET/POST/PUT /produtos/lojas`) é o ID do **produto** na Nuvemshop; em produto com **várias variantes** o Bling
guarda o ID da **variante**. A loja atual é `206304549` (NUVEMSHOP BARBERS WORLD); a antiga (`205291049`) ficou com os vínculos da integração
anterior. O vínculo **não** faz o Bling empurrar estoque na hora — por isso o estoque é gravado direto na Nuvemshop.

| Campo do workflow | Script | O que faz |
|---|---|---|
| `explorar_vinculos_lojas` (ids de produto) | `explorar-vinculos-lojas-bling.py` | SÓ LEITURA: mostra vínculos, cadastro completo, saldos, depósitos e categorias de produtos |
| `sync_vinculos_lojas` | `sync-vinculos-lojas-bling.py` | SÓ LEITURA no Bling: lê todos os vínculos (~5.000, ~30 s) -> `barbers.produtos_lojas` |
| `comparar_estoque` | `sync-estoque-bling-nuvemshop.py` | SÓ LEITURA: saldo do Bling x estoque da Nuvemshop -> `barbers.estoque_saldos_bling` |
| `vincular_produto_loja` (`ID_PRODUTO:ID_LOJA:ID_NA_LOJA:PRECO_CADASTRO:PRECO_VINCULO:ESTOQUE`) | `vincular-produto-loja-bling.py` | ESCRITA no Bling, 1 produto (teste), com travas e releitura |
| `vincular_lote` (quantos) | `vincular-lote-loja-bling.py` | ESCRITA no Bling: cria/corrige o vínculo dos candidatos de `obter_vinculos_a_gravar()`; auditoria em `vinculos_lojas_alteracoes` |
| `atualizar_estoque_nuvemshop` (`ID_BLING:ID_VARIANTE:ESTOQUE_ATUAL:SALDO`) | `sync-estoque-bling-nuvemshop.py` | ESCRITA na Nuvemshop, 1 variante (teste) |
| `atualizar_estoque_lote` (quantas) | `sync-estoque-bling-nuvemshop.py` | ESCRITA na Nuvemshop: `stock` = saldo virtual do Bling (negativo = 0; zera, reabre, controla as ilimitadas); auditoria em `estoque_nuvemshop_alteracoes` |
| `gravar_marca_nuvemshop` (`PRODUTO_NS:MARCA_ATUAL_ESPERADA:MARCA_NOVA` separados por `\|`) | `gravar-marca-nuvemshop.py` | ESCRITA na Nuvemshop: grava só o campo `brand` (correção pontual/restauração); só grava se a marca atual for a esperada; relê e confere (marca nova, categorias e publicação intactas); espelha no banco e audita em `nuvemshop_alteracoes_marca_categoria` |
| `aplicar_titulos_maquinas` (quantos, por sistema) + `titulos_sistema` (`nuvemshop`/`bling`/`ambos`) | `aplicar-titulos-maquinas.py` | ESCRITA do **nome** padronizado das máquinas (corte, acabamento, shaver): grava os títulos `APROVADO` de `barbers.titulos_propostas` na Nuvemshop e/ou no Bling, só o nome. Nuvemshop: fixa o `handle` (renomear não muda o link) e confere publicação/preço/estoque/SKU intactos; Bling: PATCH só com `nome`, confere código e preço; espera e repete no 429; auditoria em `titulos_alteracoes` (SQL e regra de geração em `sql/titulos_propostas.sql`) |
| `remover_categorias_nuvemshop` (`ID_CATEGORIA:NOME_ESPERADO` separados por `\|`) | `remover-categorias-nuvemshop.py` | **EXCLUSÃO** na Nuvemshop de categorias vazias: só apaga a que, ao vivo, tem o nome esperado, nenhuma subcategoria e nenhum produto; relê (404) e para no primeiro erro. O espelho `nuvemshop_categorias` se corrige no próximo ETL do catálogo |
| `diagnosticar_produto_nuvemshop` (ids de produto) | `diagnosticar-produto-nuvemshop.py` | SÓ LEITURA: marca, categorias e pai de cada categoria direto da API da Nuvemshop |
| `aplicar_sku_lote` (quantas) + `aplicar_sku_plano` (`PRODUTO_NS:VARIANTE_NS:CODIGO_BLING` separados por `\|`) | `aplicar-sku-nuvemshop.py` | ESCRITA na Nuvemshop: grava o código exato do Bling no `sku` das variantes do plano (só o campo `sku`; relê e confere preço/promoção/estoque/publicação intactos); valida no banco que o código existe em 1 produto ativo e não é de outra variante; auditoria em `nuvemshop_alteracoes_sku` (origem `escolha`) |

Boas práticas que valeram: **teste com 1 produto antes do lote** (o usuário confere manualmente), travas ao vivo por item (produto ativo, SKU
ainda idêntico, estado esperado do vínculo/estoque), **releitura depois de gravar**, 3 erros seguidos interrompem, auditoria de cada tentativa e
comparação da loja inteira antes x depois (preço/promoção/SKU/publicação não podem mudar). O job tem `timeout-minutes: 35`: ~5 s por vínculo no
Bling, então lotes de vínculo grandes devem ser divididos (ex.: 250 por disparo). Resultado de 13/10/2026: 762 vínculos criados/corrigidos
(1.764 de 1.764 SKUs idênticos vinculados) e 381 estoques alinhados, 0 erros, 0 mudanças de preço. SQL: `sql/create_table_produtos_lojas.sql`,
`sql/rpc_processar_carga_produtos_lojas.sql`, `sql/rpc_vinculos_lote_loja.sql`, `sql/rpc_estoque_bling_nuvemshop.sql`.

## Segurança (acesso às funções do banco)

Desde 09/10/2026 as funções `processar_carga_*`, `inativar_produtos_fora_listagem`,
`obter_contatos_pendentes_sync`, `obter_produtos_pendentes_sync` e `debug_*` só aceitam a chave
**`service_role`** (antes qualquer pessoa com a chave anon, que é pública, as executava). O segredo
`SUPABASE_SERVICE_KEY` (GitHub e `.env`) tem que ser a `service_role`, não a `anon`. Os arquivos `sql/rpc_debug_*.sql`
e `rpc_processar_carga_*.sql` desta pasta **não** trazem o `REVOKE`: se forem reaplicados, rode de novo
`dashboard/sql/seguranca_revogar_acesso_publico.sql`.

## Segredos no GitHub Actions

O workflow `.github/workflows/etl-hourly.yml` lê **segredos do repositório** (Settings → Secrets and variables →
Actions), sem depender de nenhum "environment" (antes ficavam num ambiente criado pela integração da Vercel). São
eles: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_REDIRECT_URI` e,
opcional, `DISCORD_WEBHOOK_URL`. O primeiro passo do job (`Confere os segredos`) falha com mensagem clara se faltar
algum ou se a chave do Supabase não for a `service_role`.

Para cadastrar ou atualizar (a partir do `.env` local do ETL, sem mostrar valores; valida a `service_role` antes):

```bash
bash scripts/mover-segredos-etl-github.sh        # na raiz do repositório; precisa do gh logado
```

Se o `refresh_token` do Bling for refeito ou a chave do Supabase rotacionada, atualize o `.env` e rode o script de novo.

