-- Debug temporário: pega alguns id_pedido distintos que batem um filtro simples de igualdade.
DROP FUNCTION IF EXISTS debug_amostra_pedidos(TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION debug_amostra_pedidos(p_schema_name TEXT, p_tabela TEXT, p_coluna TEXT, p_valor TEXT)
RETURNS TABLE(id_pedido BIGINT, numero INTEGER, data DATE, nome_contato TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format(
        'SELECT DISTINCT id_pedido, numero, data, nome_contato::TEXT FROM %I.%I WHERE %I::TEXT = %L LIMIT 5',
        p_schema_name, p_tabela, p_coluna, p_valor
    );
    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION debug_amostra_pedidos(TEXT, TEXT, TEXT, TEXT) TO service_role;
