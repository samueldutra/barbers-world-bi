DROP FUNCTION IF EXISTS debug_contar_distintos(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION debug_contar_distintos(p_schema_name TEXT, p_tabela TEXT, p_coluna TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
    v_total BIGINT;
BEGIN
    v_sql := format('SELECT count(DISTINCT %I) FROM %I.%I', p_coluna, p_schema_name, p_tabela);
    EXECUTE v_sql INTO v_total;
    RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION debug_contar_distintos(TEXT, TEXT, TEXT) TO service_role;
