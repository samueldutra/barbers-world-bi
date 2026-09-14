-- Tabela de pedidos de venda do Bling, denormalizada (cabeçalho + item), seguindo o
-- mesmo padrão de `faturamento` do etl-faturamento (uma linha por item do pedido).
-- Execute substituindo "barbers" pelo schema do cliente, se for reusar para outro tenant.

CREATE TABLE IF NOT EXISTS barbers.pedidos_vendas (
    -- Chave primária: pedido + item
    id_pedido               BIGINT NOT NULL,
    id_item                 BIGINT NOT NULL,

    -- Cabeçalho do pedido
    numero                  INTEGER,
    numero_loja             VARCHAR(50),
    data                    DATE,
    data_saida              DATE,
    data_prevista           DATE,
    total_produtos          DECIMAL(15,2),
    total                   DECIMAL(15,2),

    -- Contato (cliente)
    id_contato               BIGINT,
    nome_contato              VARCHAR(200),
    tipo_pessoa_contato       CHAR(1),
    documento_contato          VARCHAR(20),

    -- Situação do pedido (id/valor numéricos; descrição fica em tabela de referência do Bling)
    id_situacao              INTEGER,
    valor_situacao           INTEGER,

    -- Loja / vendedor / categoria financeira
    id_loja                  BIGINT,
    id_vendedor               BIGINT,
    id_categoria               BIGINT,

    -- Desconto e despesas do pedido
    desconto_valor            DECIMAL(15,2),
    desconto_unidade          VARCHAR(12),
    outras_despesas            DECIMAL(15,2),

    numero_pedido_compra       VARCHAR(50),
    observacoes                TEXT,
    observacoes_internas       TEXT,

    -- Transporte
    frete_por_conta            SMALLINT,
    valor_frete                DECIMAL(15,2),
    quantidade_volumes         INTEGER,
    peso_bruto                 DECIMAL(15,3),
    prazo_entrega               INTEGER,

    -- Item
    codigo_item                 VARCHAR(100),
    descricao_item              VARCHAR(255),
    descricao_detalhada_item    TEXT,
    unidade_item                 VARCHAR(10),
    quantidade_item              DECIMAL(15,4),
    valor_unitario_item          DECIMAL(15,4),
    desconto_item_percentual     DECIMAL(6,2),
    id_produto                   BIGINT,

    -- Controle
    data_extracao                DATE NOT NULL,

    PRIMARY KEY (id_pedido, id_item)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_vendas_data
    ON barbers.pedidos_vendas (data);

CREATE INDEX IF NOT EXISTS idx_pedidos_vendas_contato
    ON barbers.pedidos_vendas (id_contato);

CREATE INDEX IF NOT EXISTS idx_pedidos_vendas_situacao
    ON barbers.pedidos_vendas (id_situacao);

CREATE INDEX IF NOT EXISTS idx_pedidos_vendas_produto
    ON barbers.pedidos_vendas (id_produto);


-- Parcelas do pedido (grão diferente do item — tabela separada para não gerar produto
-- cartesiano item x parcela).
CREATE TABLE IF NOT EXISTS barbers.pedidos_vendas_parcelas (
    id_pedido           BIGINT NOT NULL,
    id_parcela           BIGINT NOT NULL,

    data_vencimento       DATE,
    valor                  DECIMAL(15,2),
    observacoes            TEXT,
    id_forma_pagamento      BIGINT,

    data_extracao           DATE NOT NULL,

    PRIMARY KEY (id_pedido, id_parcela)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_vendas_parcelas_vencimento
    ON barbers.pedidos_vendas_parcelas (data_vencimento);
