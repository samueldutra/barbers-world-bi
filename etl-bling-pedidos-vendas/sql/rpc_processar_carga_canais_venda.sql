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

    -- descricao = nome exibido no BI: nome_exibicao (renome feito só no BI) ou, se vazio,
    -- o nome do Bling. descricao_bling guarda sempre o nome do Bling.
    -- Ver canais_venda_nome_exibicao.sql.
    v_sql := format('
        INSERT INTO %I.canais_venda AS cv (
            id_loja, descricao, descricao_bling, tipo, grupo, situacao, data_sincronizacao
        )
        SELECT
            (item->>''id_loja'')::BIGINT,
            item->>''descricao'',
            item->>''descricao'',
            item->>''tipo'',
            item->>''grupo'',
            (item->>''situacao'')::SMALLINT,
            (item->>''data_sincronizacao'')::TIMESTAMPTZ
        FROM jsonb_array_elements($1) AS item
        ON CONFLICT (id_loja)
        DO UPDATE SET
            descricao = COALESCE(cv.nome_exibicao, EXCLUDED.descricao),
            descricao_bling = EXCLUDED.descricao_bling,
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
