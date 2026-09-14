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
