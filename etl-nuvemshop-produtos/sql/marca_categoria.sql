-- Marca e categoria dos produtos da Nuvemshop (módulo "Conferência de Marca e Categoria").
-- Na Nuvemshop a MARCA é um texto do produto (campo `brand`, sem cadastro próprio) e as CATEGORIAS são
-- cadastros hierárquicos (/categories, com pai); o produto guarda a lista de ids das suas categorias.
-- Marca e categorias são do PRODUTO: ficam repetidas em todas as linhas (variantes) do mesmo produto em
-- barbers.nuvemshop_produtos. Execute substituindo "barbers" pelo schema do cliente, se for reusar para outro tenant.

ALTER TABLE barbers.nuvemshop_produtos
    ADD COLUMN IF NOT EXISTS marca           VARCHAR(200),   -- NULL = produto sem marca
    ADD COLUMN IF NOT EXISTS categorias_ids  BIGINT[];       -- NULL ou vazio = produto sem categoria

-- Cadastro de categorias da loja (espelho de GET /categories; reescrito a cada execução do ETL).
CREATE TABLE IF NOT EXISTS barbers.nuvemshop_categorias (
    store_id            BIGINT NOT NULL,
    id_categoria        BIGINT NOT NULL,
    nome                VARCHAR(200) NOT NULL,   -- nome em português
    id_pai              BIGINT,                  -- NULL = categoria de topo
    data_sincronizacao  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (store_id, id_categoria)
);
ALTER TABLE barbers.nuvemshop_categorias ENABLE ROW LEVEL SECURITY;

-- Marcas criadas pelo BI antes de serem usadas em algum produto (a Nuvemshop só "conhece" a marca quando um
-- produto a recebe). A lista de marcas disponíveis = marcas dos produtos + estas.
CREATE TABLE IF NOT EXISTS barbers.nuvemshop_marcas (
    store_id    BIGINT NOT NULL,
    nome        VARCHAR(200) NOT NULL,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, nome)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_nuvemshop_marcas_nome ON barbers.nuvemshop_marcas (store_id, lower(nome));
ALTER TABLE barbers.nuvemshop_marcas ENABLE ROW LEVEL SECURITY;

-- Auditoria: toda tentativa de alterar marca/categorias de um produto (sucesso ou falha).
CREATE TABLE IF NOT EXISTS barbers.nuvemshop_alteracoes_marca_categoria (
    id                    BIGSERIAL PRIMARY KEY,
    store_id              BIGINT NOT NULL,
    id_produto_ns         BIGINT NOT NULL,
    marca_anterior        VARCHAR(200),
    marca_nova            VARCHAR(200),
    categorias_anteriores BIGINT[],
    categorias_novas      BIGINT[],
    sucesso               BOOLEAN NOT NULL,
    erro                  TEXT,
    usuario_id            UUID,
    usuario_email         TEXT,
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nuvemshop_alt_marca_cat_produto
    ON barbers.nuvemshop_alteracoes_marca_categoria (store_id, id_produto_ns, criado_em DESC);
ALTER TABLE barbers.nuvemshop_alteracoes_marca_categoria ENABLE ROW LEVEL SECURITY;

-- Carga de categorias (ETL). Só service_role.
CREATE OR REPLACE FUNCTION processar_carga_nuvemshop_categorias(
    p_data_json JSONB,
    p_schema_name TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_data_json IS NULL OR jsonb_array_length(p_data_json) = 0 THEN
        RETURN;
    END IF;
    IF p_schema_name IS NULL OR p_schema_name = '' THEN
        RAISE EXCEPTION 'Schema name é obrigatório';
    END IF;
    EXECUTE format('
        INSERT INTO %I.nuvemshop_categorias (store_id, id_categoria, nome, id_pai, data_sincronizacao)
        SELECT (i->>''store_id'')::BIGINT, (i->>''id_categoria'')::BIGINT, i->>''nome'',
               NULLIF(i->>''id_pai'', '''')::BIGINT, (i->>''data_sincronizacao'')::TIMESTAMPTZ
        FROM jsonb_array_elements($1) AS i
        ON CONFLICT (store_id, id_categoria) DO UPDATE SET
            nome = EXCLUDED.nome, id_pai = EXCLUDED.id_pai, data_sincronizacao = EXCLUDED.data_sincronizacao
    ', p_schema_name) USING p_data_json;
END;
$$;

-- Depois de carregar TODAS as categorias da loja: apaga as que foram excluídas na Nuvemshop.
CREATE OR REPLACE FUNCTION limpar_nuvemshop_categorias_removidas(
    p_schema_name TEXT,
    p_store_id BIGINT,
    p_antes_de TIMESTAMPTZ
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_removidos BIGINT;
BEGIN
    IF p_schema_name IS NULL OR p_schema_name = '' THEN
        RAISE EXCEPTION 'Schema name é obrigatório';
    END IF;
    EXECUTE format('
        WITH apagados AS (
            DELETE FROM %I.nuvemshop_categorias WHERE store_id = $1 AND data_sincronizacao < $2 RETURNING 1
        )
        SELECT count(*) FROM apagados
    ', p_schema_name) INTO v_removidos USING p_store_id, p_antes_de;
    RETURN v_removidos;
END;
$$;

REVOKE ALL ON FUNCTION processar_carga_nuvemshop_categorias(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION limpar_nuvemshop_categorias_removidas(TEXT, BIGINT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION processar_carga_nuvemshop_categorias(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION limpar_nuvemshop_categorias_removidas(TEXT, BIGINT, TIMESTAMPTZ) TO service_role;
