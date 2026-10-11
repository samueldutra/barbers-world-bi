-- Upsert de carga do ETL de produtos da Nuvemshop. Só service_role executa (chave do ETL).

CREATE OR REPLACE FUNCTION processar_carga_nuvemshop_produtos(
    p_data_json JSONB,
    p_schema_name TEXT
)
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
        INSERT INTO %I.nuvemshop_produtos (
            store_id, id_produto, id_variante, id_canal, nome, variacao, sku, codigo_barras, publicado,
            preco, preco_promocional, estoque, url, imagem_url, criado_em, atualizado_em, data_sincronizacao
        )
        SELECT
            (i->>''store_id'')::BIGINT, (i->>''id_produto'')::BIGINT, (i->>''id_variante'')::BIGINT,
            (i->>''id_canal'')::UUID, i->>''nome'', i->>''variacao'', i->>''sku'', i->>''codigo_barras'',
            (i->>''publicado'')::BOOLEAN, (i->>''preco'')::DECIMAL, (i->>''preco_promocional'')::DECIMAL,
            (i->>''estoque'')::DECIMAL, i->>''url'', i->>''imagem_url'',
            (i->>''criado_em'')::TIMESTAMPTZ, (i->>''atualizado_em'')::TIMESTAMPTZ,
            (i->>''data_sincronizacao'')::TIMESTAMPTZ
        FROM jsonb_array_elements($1) AS i
        ON CONFLICT (store_id, id_produto, id_variante) DO UPDATE SET
            id_canal = EXCLUDED.id_canal, nome = EXCLUDED.nome, variacao = EXCLUDED.variacao, sku = EXCLUDED.sku,
            codigo_barras = EXCLUDED.codigo_barras, publicado = EXCLUDED.publicado, preco = EXCLUDED.preco,
            preco_promocional = EXCLUDED.preco_promocional, estoque = EXCLUDED.estoque, url = EXCLUDED.url,
            imagem_url = EXCLUDED.imagem_url, criado_em = EXCLUDED.criado_em, atualizado_em = EXCLUDED.atualizado_em,
            data_sincronizacao = EXCLUDED.data_sincronizacao
    ', p_schema_name) USING p_data_json;
END;
$$;

-- Depois de carregar o catálogo COMPLETO de uma loja: apaga o que não veio nesta execução
-- (produto/variante excluído na Nuvemshop). O ETL só chama isto quando todas as páginas foram lidas.
CREATE OR REPLACE FUNCTION limpar_nuvemshop_produtos_removidos(
    p_schema_name TEXT,
    p_store_id BIGINT,
    p_antes_de TIMESTAMPTZ
)
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
        WITH apagados AS (
            DELETE FROM %I.nuvemshop_produtos
            WHERE store_id = $1 AND data_sincronizacao < $2
            RETURNING 1
        )
        SELECT count(*) FROM apagados
    ', p_schema_name) INTO v_removidos USING p_store_id, p_antes_de;
    RETURN v_removidos;
END;
$$;

REVOKE ALL ON FUNCTION processar_carga_nuvemshop_produtos(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION limpar_nuvemshop_produtos_removidos(TEXT, BIGINT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION processar_carga_nuvemshop_produtos(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION limpar_nuvemshop_produtos_removidos(TEXT, BIGINT, TIMESTAMPTZ) TO service_role;
