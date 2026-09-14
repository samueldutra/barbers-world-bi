-- RPCs de produto/categoria/marca. Reaproveitam situacoes_validas_faturamento()
-- (sql/rpc_dashboard_vendas.sql) e a dimensão barbers.produtos (marca/categoria).
--
-- Nota: aqui o faturamento é recomputado por item (valor_unitario_item * quantidade_item),
-- diferente dos KPIs gerais (que usam pedido.total) — é a única forma de atribuir
-- faturamento a um produto específico. Pequenas diferenças de centavos vs. o total do
-- pedido são esperadas (desconto costuma ser lançado no cabeçalho, não por item).

CREATE OR REPLACE FUNCTION obter_ranking_produtos(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE,
    p_canais BIGINT[] DEFAULT NULL,
    p_ordenar_por TEXT DEFAULT 'faturamento', -- 'faturamento' | 'unidades' | 'pedidos'
    p_limite INTEGER DEFAULT 20
)
RETURNS TABLE(
    id_produto BIGINT,
    codigo TEXT,
    nome TEXT,
    marca TEXT,
    categoria_descricao TEXT,
    imagem_url TEXT,
    unidades_vendidas NUMERIC,
    faturamento NUMERIC,
    pedidos BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
    v_ordenar_coluna TEXT;
BEGIN
    v_ordenar_coluna := CASE p_ordenar_por
        WHEN 'unidades' THEN 'unidades_vendidas'
        WHEN 'pedidos' THEN 'pedidos'
        ELSE 'faturamento'
    END;

    v_sql := format('
        SELECT
            pv.id_produto,
            p.codigo::TEXT,
            COALESCE(p.nome, MIN(pv.descricao_item))::TEXT AS nome,
            NULLIF(TRIM(p.marca), '''')::TEXT AS marca,
            NULLIF(TRIM(p.categoria_descricao), '''')::TEXT AS categoria_descricao,
            p.imagem_url::TEXT,
            sum(pv.quantidade_item)::NUMERIC AS unidades_vendidas,
            sum(pv.valor_unitario_item * pv.quantidade_item)::NUMERIC AS faturamento,
            count(DISTINCT pv.id_pedido)::BIGINT AS pedidos
        FROM %I.pedidos_vendas pv
        LEFT JOIN %I.produtos p ON p.id_produto = pv.id_produto
        WHERE pv.data BETWEEN %L AND %L
          AND (%L::BIGINT[] IS NULL OR pv.id_loja = ANY(%L::BIGINT[]))
          AND pv.id_situacao = ANY(situacoes_validas_faturamento())
        GROUP BY pv.id_produto, p.codigo, p.nome, p.marca, p.categoria_descricao, p.imagem_url,
                 (CASE WHEN pv.id_produto IS NULL THEN pv.descricao_item END)
        ORDER BY %I DESC
        LIMIT %L
    ', p_schema_name, p_schema_name, p_data_inicial, p_data_final, p_canais, p_canais, v_ordenar_coluna, p_limite);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_ranking_produtos(TEXT, DATE, DATE, BIGINT[], TEXT, INTEGER) TO authenticated;


CREATE OR REPLACE FUNCTION obter_vendas_por_categoria(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE,
    p_canais BIGINT[] DEFAULT NULL,
    p_limite INTEGER DEFAULT 15
)
RETURNS TABLE(
    categoria_descricao TEXT,
    unidades_vendidas NUMERIC,
    faturamento NUMERIC,
    pedidos BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT
            COALESCE(NULLIF(TRIM(p.categoria_descricao), ''''), ''Sem categoria'')::TEXT AS categoria_descricao,
            sum(pv.quantidade_item)::NUMERIC AS unidades_vendidas,
            sum(pv.valor_unitario_item * pv.quantidade_item)::NUMERIC AS faturamento,
            count(DISTINCT pv.id_pedido)::BIGINT AS pedidos
        FROM %I.pedidos_vendas pv
        LEFT JOIN %I.produtos p ON p.id_produto = pv.id_produto
        WHERE pv.data BETWEEN %L AND %L
          AND (%L::BIGINT[] IS NULL OR pv.id_loja = ANY(%L::BIGINT[]))
          AND pv.id_situacao = ANY(situacoes_validas_faturamento())
        GROUP BY COALESCE(NULLIF(TRIM(p.categoria_descricao), ''''), ''Sem categoria'')
        ORDER BY faturamento DESC
        LIMIT %L
    ', p_schema_name, p_schema_name, p_data_inicial, p_data_final, p_canais, p_canais, p_limite);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_vendas_por_categoria(TEXT, DATE, DATE, BIGINT[], INTEGER) TO authenticated;


CREATE OR REPLACE FUNCTION obter_vendas_por_marca(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE,
    p_canais BIGINT[] DEFAULT NULL,
    p_limite INTEGER DEFAULT 15
)
RETURNS TABLE(
    marca TEXT,
    unidades_vendidas NUMERIC,
    faturamento NUMERIC,
    pedidos BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT
            COALESCE(NULLIF(TRIM(p.marca), ''''), ''Sem marca'')::TEXT AS marca,
            sum(pv.quantidade_item)::NUMERIC AS unidades_vendidas,
            sum(pv.valor_unitario_item * pv.quantidade_item)::NUMERIC AS faturamento,
            count(DISTINCT pv.id_pedido)::BIGINT AS pedidos
        FROM %I.pedidos_vendas pv
        LEFT JOIN %I.produtos p ON p.id_produto = pv.id_produto
        WHERE pv.data BETWEEN %L AND %L
          AND (%L::BIGINT[] IS NULL OR pv.id_loja = ANY(%L::BIGINT[]))
          AND pv.id_situacao = ANY(situacoes_validas_faturamento())
        GROUP BY COALESCE(NULLIF(TRIM(p.marca), ''''), ''Sem marca'')
        ORDER BY faturamento DESC
        LIMIT %L
    ', p_schema_name, p_schema_name, p_data_inicial, p_data_final, p_canais, p_canais, p_limite);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_vendas_por_marca(TEXT, DATE, DATE, BIGINT[], INTEGER) TO authenticated;
