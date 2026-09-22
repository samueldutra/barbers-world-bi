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


-- Mesmo padrão de obter_contatos_pendentes_sync: os id_produto que aparecem em
-- pedidos_vendas e ainda não têm detalhe em produtos (ou estão desatualizados), mais os
-- ativos do catálogo que ainda não tiveram o detalhe buscado.
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
          AND (p.id_produto IS NULL OR p.data_sincronizacao IS NULL
               OR p.data_sincronizacao < now() - (%L || '' days'')::INTERVAL)
        UNION
        -- Produtos ativos que só vieram da listagem (nunca vendidos): falta o detalhe
        -- (marca/categoria). Busca uma vez; depois só revalida quem vende.
        SELECT p.id_produto
        FROM %I.produtos p
        WHERE p.data_sincronizacao IS NULL
          AND p.situacao = ''A''
        LIMIT %L
    ', p_schema_name, p_schema_name, p_dias_revalidar, p_schema_name, p_limite);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_produtos_pendentes_sync(TEXT, INTEGER, INTEGER) TO service_role;


-- Carga a partir da LISTAGEM de ativos (GET /produtos?criterio=2). Só atualiza os campos
-- que a listagem traz — marca/categoria/data_sincronizacao (detalhe) ficam intactos, pra
-- não apagar o que o sync de detalhe já gravou. Produto novo entra com
-- data_sincronizacao NULL, o que o coloca na fila de obter_produtos_pendentes_sync.
CREATE OR REPLACE FUNCTION processar_carga_produtos_listagem(
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
            id_produto, id_produto_pai, codigo, nome, formato, situacao, imagem_url, preco,
            data_sincronizacao_listagem
        )
        SELECT
            (item->>''id_produto'')::BIGINT,
            NULLIF((item->>''id_produto_pai'')::BIGINT, 0),
            item->>''codigo'',
            item->>''nome'',
            item->>''formato'',
            item->>''situacao'',
            item->>''imagem_url'',
            (item->>''preco'')::DECIMAL,
            (item->>''data_sincronizacao_listagem'')::TIMESTAMPTZ
        FROM jsonb_array_elements($1) AS item
        ON CONFLICT (id_produto)
        DO UPDATE SET
            id_produto_pai = EXCLUDED.id_produto_pai,
            codigo = EXCLUDED.codigo,
            nome = EXCLUDED.nome,
            formato = EXCLUDED.formato,
            situacao = EXCLUDED.situacao,
            imagem_url = EXCLUDED.imagem_url,
            preco = EXCLUDED.preco,
            data_sincronizacao_listagem = EXCLUDED.data_sincronizacao_listagem
    ', p_schema_name);

    EXECUTE v_sql USING p_data_json;
END;
$$;

GRANT EXECUTE ON FUNCTION processar_carga_produtos_listagem(JSONB, TEXT) TO service_role;


-- Depois de uma varredura COMPLETA da listagem de ativos: quem está como 'A' na tabela e
-- não apareceu nessa varredura foi inativado/excluído no Bling -> marca 'I'. Só chamar
-- quando todas as páginas foram lidas sem erro (senão inativaria produto ativo).
CREATE OR REPLACE FUNCTION inativar_produtos_fora_listagem(
    p_schema_name TEXT,
    p_inicio_varredura TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_qtde INTEGER;
BEGIN
    EXECUTE format('
        UPDATE %I.produtos
        SET situacao = ''I''
        WHERE situacao = ''A''
          AND (data_sincronizacao_listagem IS NULL OR data_sincronizacao_listagem < $1)
    ', p_schema_name) USING p_inicio_varredura;

    GET DIAGNOSTICS v_qtde = ROW_COUNT;
    RETURN v_qtde;
END;
$$;

GRANT EXECUTE ON FUNCTION inativar_produtos_fora_listagem(TEXT, TIMESTAMPTZ) TO service_role;
