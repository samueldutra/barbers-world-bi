# CLAUDE.md

> Responder sempre em português do Brasil.

## O que é

ETL do **catálogo da Nuvemshop** (API v1) → Supabase (`barbers.nuvemshop_produtos`, **uma linha por variante**).
Serve ao módulo **Vínculo de SKU** do dashboard: cruza o SKU de cada variante publicada na Nuvemshop com
`barbers.produtos.codigo` (SKU do Bling) pra mostrar o que está vinculado e o que não está. Base também pra, depois,
comparar o preço por canal.

## Comandos

```bash
pip install -r requirements.txt
cp .env.example .env   # preencher SUPABASE_URL / SUPABASE_SERVICE_KEY (service_role)
python etl-nuvemshop-produtos.py
```

Roda também no GitHub Actions (`.github/workflows/etl-hourly.yml`, passo "Nuvemshop (catálogo de produtos)", mesmos
segredos do repositório; **não precisa de segredo novo da Nuvemshop**).

## De onde vêm os tokens

Das lojas conectadas em **Canais de Venda** → `public.canais_integracoes` (`plataforma='nuvemshop'`,
`status='conectado'`), igual ao `etl-nuvemshop-pedidos`. O token precisa do escopo **`read_products`** (loja conectada
antes de o app ter essa permissão: reconectar em Canais de Venda). Token recusado (401/403) marca o canal como `erro`.

## Fluxo

1. `listar_produtos()` pagina `GET /v1/{store_id}/products` (200 por página, `fields` enxuto). Catálogo **completo** a
   cada execução (~10 requisições pra ~1.900 produtos) — não há filtro incremental confiável.
2. `transformar_produto()` → 1 linha por variante (`sku`, preço, preço promocional, estoque, publicado, url, imagem).
   O SKU é gravado **como está** (inclusive com espaço no fim); a normalização é feita no banco (`normalizar_sku`).
3. Upsert em lotes de 500 por `processar_carga_nuvemshop_produtos` e, só depois de carregar tudo, remove o que sumiu
   da loja com `limpar_nuvemshop_produtos_removidos` (apaga linhas com `data_sincronizacao` anterior ao início da
   execução). Catálogo vazio **não** apaga nada.

## Marca e categorias (módulo Conferência de Marca e Categoria)

O catálogo também traz a **marca** (`brand`, texto livre do produto) e as **categorias** (lista de ids) de cada produto —
gravadas em todas as variantes do mesmo produto (`marca`, `categorias_ids`) — e o **cadastro de categorias** da loja
(`GET /categories`, hierárquico: `id_pai`) em `barbers.nuvemshop_categorias`, carregado antes dos produtos
(`processar_carga_nuvemshop_categorias` + `limpar_nuvemshop_categorias_removidas`; falha nas categorias só avisa, não derruba o
catálogo). `barbers.nuvemshop_marcas` guarda as marcas criadas pelo BI que ainda não têm produto. SQL: `sql/marca_categoria.sql`.

## Banco

`sql/create_table_nuvemshop_produtos.sql` e `sql/rpc_processar_carga_nuvemshop_produtos.sql` (aplicados em 11/10/2026).
Chave: `(store_id, id_produto, id_variante)`. As RPCs de leitura do dashboard estão em
`dashboard/sql/rpc_vinculo_sku_nuvemshop.sql`.

## API da Nuvemshop — particularidades

Mesmas do `etl-nuvemshop-pedidos`: header `Authentication: bearer <token>`, `User-Agent` obrigatório, balde de 40
requisições (1,5 req/s + espera no 429), lista vazia/página além da última volta como 404, valores como string,
nome do produto por idioma (`{"pt": "..."}`). `stock` nulo = estoque não controlado.
