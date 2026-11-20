-- Vendas por horário do dia (Dashboard, aba Nuvemshop).
-- Os pedidos do Bling só guardam a DATA (sem hora), então a hora vem dos pedidos da Nuvemshop
-- (barbers.nuvemshop_pedidos.criado_em), no fuso de São Paulo. Conta pedidos não cancelados e
-- sem pagamento anulado/estornado. Sempre devolve as 24 horas (0..23), mesmo sem venda.
CREATE OR REPLACE FUNCTION obter_vendas_por_hora(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE
)
RETURNS TABLE(hora INT, faturamento NUMERIC, pedidos BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_tenant_access(p_schema_name);
    RETURN QUERY EXECUTE format('
        WITH v AS (
            SELECT EXTRACT(HOUR FROM criado_em AT TIME ZONE ''America/Sao_Paulo'')::INT AS h, total
            FROM %I.nuvemshop_pedidos
            WHERE (criado_em AT TIME ZONE ''America/Sao_Paulo'')::DATE BETWEEN %L AND %L
              AND COALESCE(status, '''') <> ''cancelled''
              AND COALESCE(status_pagamento, '''') NOT IN (''voided'', ''refunded'')
        )
        SELECT g.h, COALESCE(sum(v.total), 0)::NUMERIC, count(v.h)::BIGINT
        FROM generate_series(0, 23) AS g(h)
        LEFT JOIN v ON v.h = g.h
        GROUP BY g.h
        ORDER BY g.h
    ', p_schema_name, p_data_inicial, p_data_final);
END;
$$;

REVOKE ALL ON FUNCTION obter_vendas_por_hora(TEXT, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION obter_vendas_por_hora(TEXT, DATE, DATE) TO authenticated;
