CREATE OR REPLACE FUNCTION processar_carga_situacoes_pedido(
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
        INSERT INTO %I.situacoes_pedido (
            id_situacao, nome, id_herdado, cor, id_modulo, data_sincronizacao
        )
        SELECT
            (item->>''id_situacao'')::BIGINT,
            item->>''nome'',
            (item->>''id_herdado'')::BIGINT,
            item->>''cor'',
            (item->>''id_modulo'')::BIGINT,
            (item->>''data_sincronizacao'')::TIMESTAMPTZ
        FROM jsonb_array_elements($1) AS item
        ON CONFLICT (id_situacao)
        DO UPDATE SET
            nome = EXCLUDED.nome,
            id_herdado = EXCLUDED.id_herdado,
            cor = EXCLUDED.cor,
            id_modulo = EXCLUDED.id_modulo,
            data_sincronizacao = EXCLUDED.data_sincronizacao
    ', p_schema_name);

    EXECUTE v_sql USING p_data_json;
END;
$$;

GRANT EXECUTE ON FUNCTION processar_carga_situacoes_pedido(JSONB, TEXT) TO service_role;
