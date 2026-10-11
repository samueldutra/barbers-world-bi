-- Catálogo da Nuvemshop (API v1): UMA LINHA POR VARIANTE (produto sem variação = 1 variante).
-- É o SKU da variante que a Nuvemshop usa pra vincular ao Bling, então a granularidade é a variante.
-- Reescrito por inteiro a cada execução do ETL (catálogo completo, ~10 requisições); o que sumiu
-- da Nuvemshop é removido por limpar_nuvemshop_produtos_removidos() (ver rpc_processar_carga_...).
-- Execute substituindo "barbers" pelo schema do cliente, se for reusar para outro tenant.

CREATE TABLE IF NOT EXISTS barbers.nuvemshop_produtos (
    store_id              BIGINT NOT NULL,
    id_produto            BIGINT NOT NULL,
    id_variante           BIGINT NOT NULL,
    id_canal              UUID,             -- public.canais_integracoes.id

    nome                  VARCHAR(300),     -- nome do produto (idioma pt)
    variacao              VARCHAR(200),     -- ex.: "110V / Preto"; NULL = produto sem variação
    sku                   VARCHAR(100),     -- exatamente como está na Nuvemshop (pode ter espaços)
    codigo_barras         VARCHAR(60),
    publicado             BOOLEAN,
    preco                 DECIMAL(15,2),
    preco_promocional     DECIMAL(15,2),
    estoque               DECIMAL(15,3),    -- NULL = estoque não controlado (ilimitado)
    url                   TEXT,             -- página do produto na loja
    imagem_url            TEXT,
    criado_em             TIMESTAMPTZ,
    atualizado_em         TIMESTAMPTZ,      -- última alteração na Nuvemshop

    data_sincronizacao    TIMESTAMPTZ NOT NULL,   -- início da execução do ETL que gravou a linha

    PRIMARY KEY (store_id, id_produto, id_variante)
);

CREATE INDEX IF NOT EXISTS idx_nuvemshop_produtos_sku ON barbers.nuvemshop_produtos (upper(btrim(sku)));

-- Só acessada via RPC SECURITY DEFINER (schema barbers não é exposto no PostgREST).
ALTER TABLE barbers.nuvemshop_produtos ENABLE ROW LEVEL SECURITY;
