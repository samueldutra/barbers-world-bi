CREATE OR REPLACE FUNCTION processar_carga_produtos(
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
        INSERT INTO %I.produtos (
            id_produto, codigo, nome, marca, categoria_id, categoria_descricao,
            situacao, imagem_url, preco, data_sincronizacao
        )
        SELECT
            (item->>''id_produto'')::BIGINT,
            item->>''codigo'',
            item->>''nome'',
            item->>''marca'',
            (item->>''categoria_id'')::BIGINT,
            item->>''categoria_descricao'',
            item->>''situacao'',
            item->>''imagem_url'',
            (item->>''preco'')::DECIMAL,
            (item->>''data_sincronizacao'')::TIMESTAMPTZ
        FROM jsonb_array_elements($1) AS item
        ON CONFLICT (id_produto)
        DO UPDATE SET
            codigo = EXCLUDED.codigo,
            nome = EXCLUDED.nome,
            marca = EXCLUDED.marca,
            categoria_id = EXCLUDED.categoria_id,
            categoria_descricao = EXCLUDED.categoria_descricao,
            situacao = EXCLUDED.situacao,
            imagem_url = EXCLUDED.imagem_url,
            preco = EXCLUDED.preco,
            data_sincronizacao = EXCLUDED.data_sincronizacao
    ', p_schema_name);

    EXECUTE v_sql USING p_data_json;
END;
$$;

GRANT EXECUTE ON FUNCTION processar_carga_produtos(JSONB, TEXT) TO service_role;


-- Mesmo padrão de obter_contatos_pendentes_sync: só os id_produto que aparecem em
-- pedidos_vendas e ainda não têm linha em produtos (ou estão desatualizados).
CREATE OR REPLACE FUNCTION obter_produtos_pendentes_sync(
    p_schema_name TEXT,
    p_dias_revalidar INTEGER DEFAULT 30,
    p_limite INTEGER DEFAULT 500
)
RETURNS TABLE(id_produto BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT DISTINCT pv.id_produto
        FROM %I.pedidos_vendas pv
        LEFT JOIN %I.produtos p ON p.id_produto = pv.id_produto
        WHERE pv.id_produto IS NOT NULL
          AND pv.id_produto <> 0
          AND (p.id_produto IS NULL OR p.data_sincronizacao < now() - (%L || '' days'')::INTERVAL)
        LIMIT %L
    ', p_schema_name, p_schema_name, p_dias_revalidar, p_limite);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_produtos_pendentes_sync(TEXT, INTEGER, INTEGER) TO service_role;
