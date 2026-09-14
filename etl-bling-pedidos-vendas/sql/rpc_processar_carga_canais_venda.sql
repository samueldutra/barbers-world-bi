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


-- Agregado de vendas por canal — pensado pra alimentar o frontend do BI diretamente
-- (padrão do datapro-findash: RPC com p_schema, não leitura direta de tabela).
CREATE OR REPLACE FUNCTION obter_vendas_por_canal(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE
)
RETURNS TABLE(
    id_loja BIGINT,
    canal_descricao TEXT,
    canal_grupo TEXT,
    total_pedidos BIGINT,
    total_itens BIGINT,
    valor_total NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT
            pv.id_loja,
            cv.descricao::TEXT AS canal_descricao,
            cv.grupo::TEXT AS canal_grupo,
            count(DISTINCT pv.id_pedido)::BIGINT AS total_pedidos,
            count(*)::BIGINT AS total_itens,
            sum(pv.valor_unitario_item * pv.quantidade_item)::NUMERIC AS valor_total
        FROM %I.pedidos_vendas pv
        LEFT JOIN %I.canais_venda cv ON cv.id_loja = pv.id_loja
        WHERE pv.data BETWEEN %L AND %L
        GROUP BY pv.id_loja, cv.descricao, cv.grupo
        ORDER BY valor_total DESC NULLS LAST
    ', p_schema_name, p_schema_name, p_data_inicial, p_data_final);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_vendas_por_canal(TEXT, DATE, DATE) TO service_role;
