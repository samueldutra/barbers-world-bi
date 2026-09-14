-- RPC temporária só pra checar progresso do ETL via REST (schema barbers não está
-- exposto pro PostgREST ler direto). Pode apagar depois (DROP FUNCTION debug_contar).
-- Precisa do DROP porque o tipo de retorno mudou (TABLE -> BIGINT); OR REPLACE sozinho
-- não permite isso.
DROP FUNCTION IF EXISTS debug_contar(TEXT, TEXT);

CREATE OR REPLACE FUNCTION debug_contar(p_schema_name TEXT, p_tabela TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
    v_total BIGINT;
BEGIN
    v_sql := format('SELECT count(*) FROM %I.%I', p_schema_name, p_tabela);
    EXECUTE v_sql INTO v_total;
    RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION debug_contar(TEXT, TEXT) TO service_role;
