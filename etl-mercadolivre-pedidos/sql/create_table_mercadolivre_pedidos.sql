-- Pedidos do Mercado Livre (API /orders). Uma conta de vendedor = uma linha de public.canais_integracoes
-- (módulo Canais de Venda); seller_id identifica a conta. Valores em BRL (MLB).
-- Aplicar no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS barbers.mercadolivre_pedidos (
    seller_id          BIGINT NOT NULL,
    id_pedido          BIGINT NOT NULL,
    id_canal           UUID,              -- public.canais_integracoes.id
    pack_id            BIGINT,            -- carrinho: várias orders com o mesmo pack_id
    status             VARCHAR(30),       -- confirmed | payment_required | payment_in_process | paid | cancelled ...
    status_detalhe     VARCHAR(100),
    tags               TEXT,              -- ex.: paid,delivered,not_delivered
    motivo_cancelamento VARCHAR(200),

    criado_em          TIMESTAMPTZ,
    fechado_em         TIMESTAMPTZ,       -- 1ª confirmação/pagamento
    atualizado_em      TIMESTAMPTZ,

    total              DECIMAL(15,2),     -- total_amount (itens)
    total_pago         DECIMAL(15,2),     -- paid_amount (inclui frete pago pelo comprador)
    moeda              VARCHAR(5),
    comissao           DECIMAL(15,2),     -- soma de sale_fee x quantidade dos itens (conferir na 1ª carga)
    taxa_pagamento     DECIMAL(15,2),     -- soma de marketplace_fee dos pagamentos, quando vier
    frete_id           BIGINT,            -- /shipments/{id} (custo de frete ainda não carregado)

    forma_pagamento    VARCHAR(40),       -- payment_method_id do 1º pagamento aprovado
    tipo_pagamento     VARCHAR(40),       -- credit_card | account_money | ticket ...
    parcelas           INTEGER,
    canal_origem       VARCHAR(30),       -- context.channel: marketplace | mp-channel | proximity

    comprador_id       BIGINT,
    comprador_apelido  VARCHAR(100),

    data_extracao      DATE NOT NULL,

    PRIMARY KEY (seller_id, id_pedido)
);

CREATE INDEX IF NOT EXISTS idx_ml_pedidos_criado ON barbers.mercadolivre_pedidos (criado_em);
CREATE INDEX IF NOT EXISTS idx_ml_pedidos_status ON barbers.mercadolivre_pedidos (status);
CREATE INDEX IF NOT EXISTS idx_ml_pedidos_pack ON barbers.mercadolivre_pedidos (pack_id);

-- Itens do pedido (grão diferente — tabela separada). `seq` = posição em order_items (estável por pedido).
CREATE TABLE IF NOT EXISTS barbers.mercadolivre_pedidos_itens (
    seller_id        BIGINT NOT NULL,
    id_pedido        BIGINT NOT NULL,
    seq              INTEGER NOT NULL,
    id_anuncio       VARCHAR(20),         -- MLB123...
    id_variacao      BIGINT,
    sku              VARCHAR(100),        -- seller_sku (ou seller_custom_field): chave pra casar com o Bling
    titulo           VARCHAR(300),
    categoria_id     VARCHAR(20),
    quantidade       DECIMAL(15,3),
    preco            DECIMAL(15,2),       -- unit_price
    preco_cheio      DECIMAL(15,2),       -- full_unit_price (antes de promoção), quando vier
    comissao_unit    DECIMAL(15,2),       -- sale_fee
    tipo_anuncio     VARCHAR(30),         -- gold_special | gold_pro ...
    data_extracao    DATE NOT NULL,

    PRIMARY KEY (seller_id, id_pedido, seq)
);

CREATE INDEX IF NOT EXISTS idx_ml_itens_sku ON barbers.mercadolivre_pedidos_itens (sku);
CREATE INDEX IF NOT EXISTS idx_ml_itens_anuncio ON barbers.mercadolivre_pedidos_itens (id_anuncio);
