-- Debug temporário: contagem agrupada por uma coluna (ex.: id_loja) numa tabela do schema do tenant.
DROP FUNCTION IF EXISTS debug_agrupar(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION debug_agrupar(p_schema_name TEXT, p_tabela TEXT, p_coluna TEXT)
RETURNS TABLE(valor TEXT, total BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format(
        'SELECT %I::TEXT AS valor, count(*)::BIGINT AS total FROM %I.%I GROUP BY 1 ORDER BY 2 DESC',
        p_coluna, p_schema_name, p_tabela
    );
    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION debug_agrupar(TEXT, TEXT, TEXT) TO service_role;
