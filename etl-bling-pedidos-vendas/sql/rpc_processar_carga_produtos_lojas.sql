-- Carga dos vínculos produto x loja do Bling. Só service_role executa (chave do ETL).

CREATE OR REPLACE FUNCTION processar_carga_produtos_lojas(p_data_json JSONB, p_schema_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_data_json IS NULL OR jsonb_array_length(p_data_json) = 0 THEN
        RETURN;
    END IF;
    IF p_schema_name IS NULL OR p_schema_name = '' THEN
        RAISE EXCEPTION 'Schema name é obrigatório';
    END IF;

    EXECUTE format('
        INSERT INTO %I.produtos_lojas (
            id_vinculo, id_produto, id_loja, codigo, preco, preco_promocional,
            id_fornecedor_loja, id_marca_loja, qtd_categorias, data_sincronizacao
        )
        SELECT
            (i->>''id_vinculo'')::BIGINT, (i->>''id_produto'')::BIGINT, (i->>''id_loja'')::BIGINT, i->>''codigo'',
            (i->>''preco'')::DECIMAL, (i->>''preco_promocional'')::DECIMAL,
            (i->>''id_fornecedor_loja'')::BIGINT, (i->>''id_marca_loja'')::BIGINT, (i->>''qtd_categorias'')::INTEGER,
            (i->>''data_sincronizacao'')::TIMESTAMPTZ
        FROM jsonb_array_elements($1) AS i
        ON CONFLICT (id_vinculo) DO UPDATE SET
            id_produto = EXCLUDED.id_produto, id_loja = EXCLUDED.id_loja, codigo = EXCLUDED.codigo,
            preco = EXCLUDED.preco, preco_promocional = EXCLUDED.preco_promocional,
            id_fornecedor_loja = EXCLUDED.id_fornecedor_loja, id_marca_loja = EXCLUDED.id_marca_loja,
            qtd_categorias = EXCLUDED.qtd_categorias, data_sincronizacao = EXCLUDED.data_sincronizacao
    ', p_schema_name) USING p_data_json;
END;
$$;

-- Depois de carregar TODOS os vínculos: apaga os que não vieram nesta execução (vínculo removido no Bling).
CREATE OR REPLACE FUNCTION limpar_produtos_lojas_removidos(p_schema_name TEXT, p_antes_de TIMESTAMPTZ)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_removidos BIGINT;
BEGIN
    IF p_schema_name IS NULL OR p_schema_name = '' THEN
        RAISE EXCEPTION 'Schema name é obrigatório';
    END IF;
    EXECUTE format('
        WITH apagados AS (DELETE FROM %I.produtos_lojas WHERE data_sincronizacao < $1 RETURNING 1)
        SELECT count(*) FROM apagados
    ', p_schema_name) INTO v_removidos USING p_antes_de;
    RETURN v_removidos;
END;
$$;

REVOKE ALL ON FUNCTION processar_carga_produtos_lojas(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION limpar_produtos_lojas_removidos(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION processar_carga_produtos_lojas(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION limpar_produtos_lojas_removidos(TEXT, TIMESTAMPTZ) TO service_role;
