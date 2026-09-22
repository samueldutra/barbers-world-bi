-- Lista de preços por produto: preço atual de cadastro no Bling (produtos.preco, mantido em
-- dia pela listagem de ativos do sync-produtos-bling.py) x preço praticado na última venda
-- válida (pedidos_vendas.valor_unitario_item do pedido mais recente, mesmas situações de
-- situacoes_validas_faturamento() usadas no resto do BI).
--
-- Base = dimensão produtos (catálogo), não as vendas: produto ativo que nunca vendeu
-- aparece com ultimo_preco_venda NULL. Paginado server-side (o Supabase corta RPC em ~1000
-- linhas) com total_registros replicado em cada linha, como obter_relatorio_vendas_produtos.
CREATE OR REPLACE FUNCTION obter_produtos_precos(
    p_schema_name TEXT,
    p_busca TEXT DEFAULT NULL,
    p_marca TEXT DEFAULT NULL,        -- NULL = "Todos"; valor deve bater com obter_marcas_produtos()
    p_categoria TEXT DEFAULT NULL,    -- NULL = "Todos"; valor deve bater com obter_categorias_produtos()
    p_somente_ativos BOOLEAN DEFAULT TRUE,
    p_ordenar_por TEXT DEFAULT 'nome', -- 'nome' | 'preco_atual' | 'ultimo_preco_venda' | 'data_ultima_venda' | 'diferenca_percentual'
    p_ordenar_direcao TEXT DEFAULT 'asc',
    p_pagina INTEGER DEFAULT 1,
    p_tamanho_pagina INTEGER DEFAULT 50
)
RETURNS TABLE(
    id_produto BIGINT,
    codigo TEXT,
    nome TEXT,
    marca TEXT,
    categoria_descricao TEXT,
    situacao TEXT,
    imagem_url TEXT,
    preco_atual NUMERIC,
    ultimo_preco_venda NUMERIC,             -- valor unitário do item no pedido (antes do desconto do item)
    ultimo_desconto_item_percentual NUMERIC,
    data_ultima_venda DATE,
    numero_pedido_ultima_venda INTEGER,
    diferenca_percentual NUMERIC,           -- (ultimo_preco_venda / preco_atual - 1) * 100
    total_registros BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
    v_ordenar_coluna TEXT;
    v_ordenar_direcao TEXT;
    v_busca_pattern TEXT;
    v_offset INTEGER;
BEGIN
    v_ordenar_coluna := CASE p_ordenar_por
        WHEN 'preco_atual' THEN 'preco_atual'
        WHEN 'ultimo_preco_venda' THEN 'ultimo_preco_venda'
        WHEN 'data_ultima_venda' THEN 'data_ultima_venda'
        WHEN 'diferenca_percentual' THEN 'diferenca_percentual'
        ELSE 'nome'
    END;
    v_ordenar_direcao := CASE lower(p_ordenar_direcao) WHEN 'desc' THEN 'DESC' ELSE 'ASC' END;
    v_busca_pattern := CASE WHEN p_busca IS NULL OR trim(p_busca) = '' THEN NULL ELSE '%' || trim(p_busca) || '%' END;
    v_offset := (GREATEST(p_pagina, 1) - 1) * GREATEST(p_tamanho_pagina, 1);

    v_sql := format('
        WITH ultima_venda AS (
            SELECT DISTINCT ON (pv.id_produto)
                pv.id_produto,
                pv.valor_unitario_item,
                pv.desconto_item_percentual,
                pv.data,
                pv.numero
            FROM %I.pedidos_vendas pv
            WHERE pv.id_produto IS NOT NULL
              AND pv.id_situacao = ANY(situacoes_validas_faturamento())
            ORDER BY pv.id_produto, pv.data DESC, pv.id_pedido DESC, pv.id_item DESC
        ),
        base AS (
            SELECT
                p.id_produto,
                p.codigo::TEXT AS codigo,
                p.nome::TEXT AS nome,
                NULLIF(TRIM(p.marca), '''')::TEXT AS marca,
                NULLIF(TRIM(p.categoria_descricao), '''')::TEXT AS categoria_descricao,
                p.situacao::TEXT AS situacao,
                p.imagem_url::TEXT AS imagem_url,
                p.preco::NUMERIC AS preco_atual,
                uv.valor_unitario_item::NUMERIC AS ultimo_preco_venda,
                uv.desconto_item_percentual::NUMERIC AS ultimo_desconto_item_percentual,
                uv.data AS data_ultima_venda,
                uv.numero AS numero_pedido_ultima_venda,
                CASE WHEN p.preco > 0 AND uv.valor_unitario_item IS NOT NULL
                     THEN round((uv.valor_unitario_item / p.preco - 1) * 100, 2)
                END::NUMERIC AS diferenca_percentual
            FROM %I.produtos p
            LEFT JOIN ultima_venda uv ON uv.id_produto = p.id_produto
            WHERE (NOT %L::BOOLEAN OR p.situacao = ''A'')
              AND (%L::TEXT IS NULL OR p.nome ILIKE %L OR p.codigo ILIKE %L)
              AND (%L::TEXT IS NULL OR COALESCE(NULLIF(TRIM(p.marca), ''''), ''Sem marca'') = %L)
              AND (%L::TEXT IS NULL OR COALESCE(NULLIF(TRIM(p.categoria_descricao), ''''), ''Sem categoria'') = %L)
        )
        SELECT *, count(*) OVER()::BIGINT AS total_registros
        FROM base
        ORDER BY %I %s NULLS LAST, id_produto
        LIMIT %L OFFSET %L
    ', p_schema_name, p_schema_name, p_somente_ativos,
       v_busca_pattern, v_busca_pattern, v_busca_pattern,
       p_marca, p_marca, p_categoria, p_categoria,
       v_ordenar_coluna, v_ordenar_direcao, p_tamanho_pagina, v_offset);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_produtos_precos(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
