-- Vínculos produto x loja virtual do Bling (GET /produtos/lojas): o campo "ID na loja" (`codigo`) e os preços por loja
-- que aparecem em Cadastros > Produtos > (produto) > loja. Uma linha por vínculo (produto x loja). Para a Nuvemshop,
-- `codigo` = ID do PRODUTO na Nuvemshop (não da variante); "0" = loja marcada no produto mas sem ID.
-- Reescrita por inteiro a cada execução do sync (o que sumiu do Bling é removido).
-- Execute substituindo "barbers" pelo schema do cliente, se for reusar para outro tenant.

CREATE TABLE IF NOT EXISTS barbers.produtos_lojas (
    id_vinculo          BIGINT PRIMARY KEY,        -- id do vínculo no Bling (usado em PUT/DELETE /produtos/lojas/{id})
    id_produto          BIGINT NOT NULL,
    id_loja             BIGINT NOT NULL,           -- = canais_venda.id_loja
    codigo              VARCHAR(200),              -- "ID na loja"
    preco               DECIMAL(15,2),
    preco_promocional   DECIMAL(15,2),
    id_fornecedor_loja  BIGINT,
    id_marca_loja       BIGINT,
    qtd_categorias      INTEGER,
    data_sincronizacao  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_produtos_lojas_produto ON barbers.produtos_lojas (id_produto);
CREATE INDEX IF NOT EXISTS idx_produtos_lojas_loja ON barbers.produtos_lojas (id_loja, codigo);

-- Só acessada via RPC SECURITY DEFINER (schema barbers não é exposto no PostgREST).
ALTER TABLE barbers.produtos_lojas ENABLE ROW LEVEL SECURITY;
