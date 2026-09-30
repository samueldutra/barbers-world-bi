CREATE OR REPLACE FUNCTION processar_carga_canais_venda(
    p_data_json JSONB,
    p_schema_name TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    IF p_data_json IS NULL OR jsonb_array_length(p_data_json) = 0 THEN
        RETURN;
    END IF;

    IF p_schema_name IS NULL OR p_schema_name = '' THEN
        RAISE EXCEPTION 'Schema name é obrigatório';
    END IF;

    v_sql := format('
        INSERT INTO %I.canais_venda (
            id_loja, descricao, tipo, grupo, situacao, data_sincronizacao
        )
        SELECT
            (item->>''id_loja'')::BIGINT,
            item->>''descricao'',
            item->>''tipo'',
            item->>''grupo'',
            (item->>''situacao'')::SMALLINT,
            (item->>''data_sincronizacao'')::TIMESTAMPTZ
        FROM jsonb_array_elements($1) AS item
        ON CONFLICT (id_loja)
        DO UPDATE SET
            descricao = EXCLUDED.descricao,
            tipo = EXCLUDED.tipo,
            grupo = EXCLUDED.grupo,
            situacao = EXCLUDED.situacao,
            data_sincronizacao = EXCLUDED.data_sincronizacao
    ', p_schema_name);

    EXECUTE v_sql USING p_data_json;
END;
$$;

GRANT EXECUTE ON FUNCTION processar_carga_canais_venda(JSONB, TEXT) TO service_role;


-- obter_vendas_por_canal (agregado pro frontend) mora em dashboard/sql/rpc_dashboard_vendas.sql
-- — a versão antiga que ficava aqui foi removida para não recriar uma sobrecarga ambígua.
