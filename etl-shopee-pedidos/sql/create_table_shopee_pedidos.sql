-- Pedidos da Shopee (Open Platform v2, /order/get_order_detail). Uma loja = uma linha de public.canais_integracoes
-- (módulo Canais de Venda); shop_id identifica a loja. Valores na moeda do pedido (BRL no Brasil).
-- Aplicar no SQL Editor do Supabase (para outro cliente, troque o schema `barbers`).

CREATE TABLE IF NOT EXISTS barbers.shopee_pedidos (
    shop_id            BIGINT NOT NULL,
    order_sn           VARCHAR(40) NOT NULL,   -- número do pedido na Shopee
    id_canal           UUID,                   -- public.canais_integracoes.id
    status             VARCHAR(30),            -- UNPAID | READY_TO_SHIP | PROCESSED | SHIPPED | COMPLETED | CANCELLED | IN_CANCEL ...
    motivo_cancelamento VARCHAR(300),

    criado_em          TIMESTAMPTZ,
    pago_em            TIMESTAMPTZ,
    atualizado_em      TIMESTAMPTZ,
    enviar_ate         TIMESTAMPTZ,            -- ship_by_date

    total              DECIMAL(15,2),          -- total_amount
    moeda              VARCHAR(5),
    forma_pagamento    VARCHAR(80),
    frete_real         DECIMAL(15,2),          -- actual_shipping_fee (0/nulo até o envio)
    frete_estimado     DECIMAL(15,2),
    transportadora     VARCHAR(80),

    comprador_id       BIGINT,                 -- buyer_user_id
    comprador_usuario  VARCHAR(100),           -- buyer_username (pode vir mascarado sem IP whitelist)

    data_extracao      DATE NOT NULL,

    PRIMARY KEY (shop_id, order_sn)
);

CREATE INDEX IF NOT EXISTS idx_shopee_pedidos_criado ON barbers.shopee_pedidos (criado_em);
CREATE INDEX IF NOT EXISTS idx_shopee_pedidos_status ON barbers.shopee_pedidos (status);

-- Itens do pedido (grão diferente). `seq` = posição em item_list (estável por pedido).
CREATE TABLE IF NOT EXISTS barbers.shopee_pedidos_itens (
    shop_id          BIGINT NOT NULL,
    order_sn         VARCHAR(40) NOT NULL,
    seq              INTEGER NOT NULL,
    item_id          BIGINT,
    model_id         BIGINT,                   -- variação
    sku              VARCHAR(100),             -- model_sku (ou item_sku): chave pra casar com o Bling
    titulo           VARCHAR(300),
    variacao         VARCHAR(200),             -- model_name
    quantidade       DECIMAL(15,3),
    preco            DECIMAL(15,2),            -- model_discounted_price
    preco_cheio      DECIMAL(15,2),            -- model_original_price
    data_extracao    DATE NOT NULL,

    PRIMARY KEY (shop_id, order_sn, seq)
);

CREATE INDEX IF NOT EXISTS idx_shopee_itens_sku ON barbers.shopee_pedidos_itens (sku);
CREATE INDEX IF NOT EXISTS idx_shopee_itens_item ON barbers.shopee_pedidos_itens (item_id);
