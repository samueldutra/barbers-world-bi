-- Módulo "Relatório de Vendas por Produto": listagem paginada/buscável de vendas por
-- produto (ordenável por qtde vendida ou valor vendido), filtrável por marca/categoria,
-- + curva ABC por categoria. Reaproveita situacoes_validas_faturamento()
-- (sql/rpc_dashboard_vendas.sql) e a mesma regra de recomputar faturamento por item
-- (valor_unitario_item * quantidade_item) usada em rpc_dashboard_produtos.sql.

-- CREATE OR REPLACE só substitui uma função de mesma assinatura — como estamos inserindo
-- p_marca/p_categoria no meio da lista de parâmetros, a assinatura antiga vira uma
-- sobrecarga órfã se não for removida explicitamente.
DROP FUNCTION IF EXISTS obter_relatorio_vendas_produtos(TEXT, DATE, DATE, BIGINT[], TEXT, TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS obter_curva_abc_categorias(TEXT, DATE, DATE, BIGINT[]);

-- Listagem de vendas por produto, com busca (nome/código/descrição do item), filtro de
-- marca/categoria, ordenação e paginação server-side. total_registros vem replicado em
-- cada linha (via count(*) OVER()) pra o frontend montar a paginação sem uma segunda
-- chamada.
CREATE OR REPLACE FUNCTION obter_relatorio_vendas_produtos(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE,
    p_canais BIGINT[] DEFAULT NULL,
    p_busca TEXT DEFAULT NULL,
    p_marca TEXT DEFAULT NULL,        -- NULL = "Todos"; valor deve bater com obter_marcas_produtos()
    p_categoria TEXT DEFAULT NULL,    -- NULL = "Todos"; valor deve bater com obter_categorias_produtos()
    p_ordenar_por TEXT DEFAULT 'valor_vendido', -- 'valor_vendido' | 'qtde_vendida'
    p_ordenar_direcao TEXT DEFAULT 'desc',      -- 'asc' | 'desc'
    p_pagina INTEGER DEFAULT 1,
    p_tamanho_pagina INTEGER DEFAULT 50
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
    pedidos BIGINT,
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
        WHEN 'qtde_vendida' THEN 'unidades_vendidas'
        ELSE 'faturamento'
    END;
    v_ordenar_direcao := CASE lower(p_ordenar_direcao) WHEN 'asc' THEN 'ASC' ELSE 'DESC' END;
    v_busca_pattern := CASE WHEN p_busca IS NULL OR trim(p_busca) = '' THEN NULL ELSE '%' || trim(p_busca) || '%' END;
    v_offset := (GREATEST(p_pagina, 1) - 1) * GREATEST(p_tamanho_pagina, 1);

    v_sql := format('
        WITH agrupado AS (
            SELECT
                pv.id_produto,
                p.codigo::TEXT AS codigo,
                COALESCE(p.nome, MIN(pv.descricao_item))::TEXT AS nome,
                NULLIF(TRIM(p.marca), '''')::TEXT AS marca,
                NULLIF(TRIM(p.categoria_descricao), '''')::TEXT AS categoria_descricao,
                p.imagem_url::TEXT AS imagem_url,
                sum(pv.quantidade_item)::NUMERIC AS unidades_vendidas,
                sum(pv.valor_unitario_item * pv.quantidade_item)::NUMERIC AS faturamento,
                count(DISTINCT pv.id_pedido)::BIGINT AS pedidos
            FROM %I.pedidos_vendas pv
            LEFT JOIN %I.produtos p ON p.id_produto = pv.id_produto
            WHERE pv.data BETWEEN %L AND %L
              AND (%L::BIGINT[] IS NULL OR pv.id_loja = ANY(%L::BIGINT[]))
              AND pv.id_situacao = ANY(situacoes_validas_faturamento())
              AND (
                    %L::TEXT IS NULL
                 OR p.nome ILIKE %L
                 OR p.codigo ILIKE %L
                 OR pv.descricao_item ILIKE %L
              )
              AND (%L::TEXT IS NULL OR COALESCE(NULLIF(TRIM(p.marca), ''''), ''Sem marca'') = %L)
              AND (%L::TEXT IS NULL OR COALESCE(NULLIF(TRIM(p.categoria_descricao), ''''), ''Sem categoria'') = %L)
            GROUP BY pv.id_produto, p.codigo, p.nome, p.marca, p.categoria_descricao, p.imagem_url,
                     (CASE WHEN pv.id_produto IS NULL THEN pv.descricao_item END)
        )
        SELECT *, count(*) OVER()::BIGINT AS total_registros
        FROM agrupado
        ORDER BY %I %s NULLS LAST
        LIMIT %L OFFSET %L
    ', p_schema_name, p_schema_name, p_data_inicial, p_data_final, p_canais, p_canais,
       v_busca_pattern, v_busca_pattern, v_busca_pattern, v_busca_pattern,
       p_marca, p_marca, p_categoria, p_categoria,
       v_ordenar_coluna, v_ordenar_direcao, p_tamanho_pagina, v_offset);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_relatorio_vendas_produtos(TEXT, DATE, DATE, BIGINT[], TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;


-- Listas pra popular os filtros de marca/categoria (seção 4.2, mesmo padrão de
-- obter_canais_venda): schema barbers não é exposto no PostgREST, então o frontend
-- passa por RPC. Vem da dimensão produtos inteira (não do período filtrado) — mesmo
-- comportamento do filtro de canal, que sempre lista todos os canais cadastrados.
CREATE OR REPLACE FUNCTION obter_marcas_produtos(p_schema_name TEXT)
RETURNS TABLE(marca TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT DISTINCT COALESCE(NULLIF(TRIM(marca), ''''), ''Sem marca'')::TEXT AS marca
        FROM %I.produtos
        ORDER BY 1
    ', p_schema_name);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_marcas_produtos(TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION obter_categorias_produtos(p_schema_name TEXT)
RETURNS TABLE(categoria_descricao TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT DISTINCT COALESCE(NULLIF(TRIM(categoria_descricao), ''''), ''Sem categoria'')::TEXT AS categoria_descricao
        FROM %I.produtos
        ORDER BY 1
    ', p_schema_name);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_categorias_produtos(TEXT) TO authenticated;


-- Curva ABC por categoria: classifica cada categoria em A/B/C pelo faturamento acumulado
-- (A = categorias cujo acumulado ANTES delas ainda é < 80%, B = < 95%, C = restante).
-- Usar o acumulado "antes da linha" evita o caso clássico de uma única categoria com
-- >80% de participação virar B por causa do próprio acumulado dela mesma.
-- p_marca filtra a base antes de agrupar (ex.: curva ABC só da marca X); p_categoria
-- também é aceito por consistência com os outros filtros, mas selecionar uma categoria
-- aqui naturalmente reduz o resultado a 1 linha (100% dela mesma).
CREATE OR REPLACE FUNCTION obter_curva_abc_categorias(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE,
    p_canais BIGINT[] DEFAULT NULL,
    p_marca TEXT DEFAULT NULL,
    p_categoria TEXT DEFAULT NULL
)
RETURNS TABLE(
    categoria_descricao TEXT,
    unidades_vendidas NUMERIC,
    faturamento NUMERIC,
    pedidos BIGINT,
    percentual_participacao NUMERIC,
    percentual_acumulado NUMERIC,
    classe_abc TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        WITH por_categoria AS (
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
              AND (%L::TEXT IS NULL OR COALESCE(NULLIF(TRIM(p.marca), ''''), ''Sem marca'') = %L)
              AND (%L::TEXT IS NULL OR COALESCE(NULLIF(TRIM(p.categoria_descricao), ''''), ''Sem categoria'') = %L)
            GROUP BY COALESCE(NULLIF(TRIM(p.categoria_descricao), ''''), ''Sem categoria'')
        ),
        total AS (
            SELECT COALESCE(sum(faturamento), 0) AS faturamento_total FROM por_categoria
        ),
        acumulado AS (
            SELECT
                pc.*,
                sum(pc.faturamento) OVER (ORDER BY pc.faturamento DESC ROWS UNBOUNDED PRECEDING) AS faturamento_acumulado,
                sum(pc.faturamento) OVER (ORDER BY pc.faturamento DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS faturamento_acumulado_anterior
            FROM por_categoria pc
        )
        SELECT
            a.categoria_descricao,
            a.unidades_vendidas,
            a.faturamento,
            a.pedidos,
            CASE WHEN t.faturamento_total > 0 THEN round((a.faturamento / t.faturamento_total) * 100, 2) ELSE 0 END AS percentual_participacao,
            CASE WHEN t.faturamento_total > 0 THEN round((a.faturamento_acumulado / t.faturamento_total) * 100, 2) ELSE 0 END AS percentual_acumulado,
            CASE
                WHEN t.faturamento_total = 0 THEN ''C''
                WHEN COALESCE(a.faturamento_acumulado_anterior, 0) / t.faturamento_total < 0.80 THEN ''A''
                WHEN COALESCE(a.faturamento_acumulado_anterior, 0) / t.faturamento_total < 0.95 THEN ''B''
                ELSE ''C''
            END AS classe_abc
        FROM acumulado a
        CROSS JOIN total t
        ORDER BY a.faturamento DESC
    ', p_schema_name, p_schema_name, p_data_inicial, p_data_final, p_canais, p_canais,
       p_marca, p_marca, p_categoria, p_categoria);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_curva_abc_categorias(TEXT, DATE, DATE, BIGINT[], TEXT, TEXT) TO authenticated;
