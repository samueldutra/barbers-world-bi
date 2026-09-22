-- Dimensão de produtos (Bling) que aparecem em pedidos_vendas — habilita ranking por
-- marca/categoria e curva ABC no BI.
-- Execute substituindo "barbers" pelo schema do cliente, se for reusar para outro tenant.

CREATE TABLE IF NOT EXISTS barbers.produtos (
    id_produto            BIGINT PRIMARY KEY,
    codigo                VARCHAR(100),   -- SKU
    nome                  VARCHAR(255),
    marca                 VARCHAR(100),
    categoria_id          BIGINT,
    categoria_descricao   VARCHAR(150),
    situacao              VARCHAR(5),
    imagem_url            TEXT,
    preco                 DECIMAL(15,2),
    data_sincronizacao    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_produtos_marca ON barbers.produtos (marca);
CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON barbers.produtos (categoria_id);

-- Migração: catálogo completo de produtos ativos (não só os que aparecem em pedidos).
-- A listagem GET /produtos?criterio=2 (ProdutosDadosBaseDTO) traz código/nome/preço/
-- situação/imagem, mas NÃO traz marca/categoria — essas continuam vindo do detalhe
-- GET /produtos/{id}. Por isso são dois carimbos de sincronização separados:
--   data_sincronizacao          = último detalhe buscado (NULL = produto só visto na listagem)
--   data_sincronizacao_listagem = última vez que o produto apareceu na listagem de ativos
ALTER TABLE barbers.produtos ALTER COLUMN data_sincronizacao DROP NOT NULL;
ALTER TABLE barbers.produtos ADD COLUMN IF NOT EXISTS data_sincronizacao_listagem TIMESTAMPTZ;
ALTER TABLE barbers.produtos ADD COLUMN IF NOT EXISTS id_produto_pai BIGINT;
ALTER TABLE barbers.produtos ADD COLUMN IF NOT EXISTS formato VARCHAR(1);

CREATE INDEX IF NOT EXISTS idx_produtos_situacao ON barbers.produtos (situacao);
