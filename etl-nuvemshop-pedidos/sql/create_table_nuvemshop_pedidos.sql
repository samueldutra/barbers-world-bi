-- Pedidos da Nuvemshop (API v1) — complementa os pedidos que o Bling já traz (frete, cupom,
-- status de pagamento/envio, forma de pagamento, cidade de entrega). Uma loja = uma linha de
-- public.canais_integracoes (módulo Canais de Venda); store_id identifica a loja.
-- Para relacionar com o Bling: nuvemshop_pedidos.numero = pedidos_vendas.numero_loja (conferir).

CREATE TABLE IF NOT EXISTS barbers.nuvemshop_pedidos (
    store_id              BIGINT NOT NULL,
    id_pedido             BIGINT NOT NULL,
    id_canal              UUID,             -- public.canais_integracoes.id
    numero                INTEGER,

    status                VARCHAR(20),      -- open | closed | cancelled
    status_pagamento      VARCHAR(20),      -- pending | authorized | paid | abandoned | refunded | voided
    status_envio          VARCHAR(20),      -- unpacked | fulfilled ...
    motivo_cancelamento   VARCHAR(50),

    criado_em             TIMESTAMPTZ,
    atualizado_em         TIMESTAMPTZ,
    pago_em               TIMESTAMPTZ,
    enviado_em            TIMESTAMPTZ,
    fechado_em            TIMESTAMPTZ,
    cancelado_em          TIMESTAMPTZ,

    subtotal              DECIMAL(15,2),
    desconto              DECIMAL(15,2),
    desconto_cupom        DECIMAL(15,2),
    desconto_gateway      DECIMAL(15,2),
    desconto_promocional  DECIMAL(15,2),
    frete_cliente         DECIMAL(15,2),    -- o que o cliente pagou de frete
    frete_loja            DECIMAL(15,2),    -- o que a loja pagou à transportadora
    total                 DECIMAL(15,2),
    moeda                 VARCHAR(5),

    gateway               VARCHAR(60),
    forma_pagamento       VARCHAR(40),
    bandeira_cartao       VARCHAR(40),
    parcelas              INTEGER,
    cupons                TEXT,
    opcao_envio           VARCHAR(120),
    loja_virtual          VARCHAR(60),

    cliente_id            BIGINT,
    cliente_nome          VARCHAR(200),
    cliente_email         VARCHAR(200),
    cliente_telefone      VARCHAR(40),
    cliente_documento     VARCHAR(30),
    entrega_cidade        VARCHAR(100),
    entrega_uf            VARCHAR(60),
    entrega_cep           VARCHAR(20),

    observacao_cliente    TEXT,
    observacao_loja       TEXT,

    data_extracao         DATE NOT NULL,

    PRIMARY KEY (store_id, id_pedido)
);

CREATE INDEX IF NOT EXISTS idx_nuvemshop_pedidos_criado ON barbers.nuvemshop_pedidos (criado_em);
CREATE INDEX IF NOT EXISTS idx_nuvemshop_pedidos_numero ON barbers.nuvemshop_pedidos (store_id, numero);
CREATE INDEX IF NOT EXISTS idx_nuvemshop_pedidos_status ON barbers.nuvemshop_pedidos (status, status_pagamento);

-- Itens do pedido (grão diferente — tabela separada, como pedidos_vendas_parcelas).
CREATE TABLE IF NOT EXISTS barbers.nuvemshop_pedidos_itens (
    store_id        BIGINT NOT NULL,
    id_pedido       BIGINT NOT NULL,
    id_item         BIGINT NOT NULL,
    id_produto      BIGINT,
    id_variante     BIGINT,
    sku             VARCHAR(100),
    codigo_barras   VARCHAR(60),
    nome            VARCHAR(300),
    quantidade      DECIMAL(15,3),
    preco           DECIMAL(15,2),    -- preço unitário vendido
    custo           DECIMAL(15,2),
    peso            DECIMAL(15,3),
    data_extracao   DATE NOT NULL,

    PRIMARY KEY (store_id, id_pedido, id_item)
);

CREATE INDEX IF NOT EXISTS idx_nuvemshop_itens_produto ON barbers.nuvemshop_pedidos_itens (id_produto);
CREATE INDEX IF NOT EXISTS idx_nuvemshop_itens_sku ON barbers.nuvemshop_pedidos_itens (sku);
