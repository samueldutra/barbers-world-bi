-- Debug temporário: confirma que o ranking usa várias situações, não só "Atendido".
DROP FUNCTION IF EXISTS debug_faturamento_por_situacao(TEXT, DATE, DATE);

CREATE OR REPLACE FUNCTION debug_faturamento_por_situacao(p_schema_name TEXT, p_data_inicial DATE, p_data_final DATE)
RETURNS TABLE(id_situacao INTEGER, faturamento NUMERIC, itens BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT pv.id_situacao, sum(pv.valor_unitario_item * pv.quantidade_item)::NUMERIC AS faturamento, count(*)::BIGINT
        FROM %I.pedidos_vendas pv
        WHERE pv.data BETWEEN %L AND %L
        GROUP BY pv.id_situacao
        ORDER BY faturamento DESC
    ', p_schema_name, p_data_inicial, p_data_final);
    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION debug_faturamento_por_situacao(TEXT, DATE, DATE) TO service_role;
