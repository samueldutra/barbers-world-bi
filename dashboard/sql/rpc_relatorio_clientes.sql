-- Módulo "Relatório de Vendas por Cliente": listagem paginada/buscável (ordenável por
-- valor vendido, qtde de pedidos ou ticket médio), filtrável por UF/cidade, com
-- marcação novo x recorrente, + curva ABC de clientes. Reaproveita
-- situacoes_validas_faturamento() (sql/rpc_dashboard_vendas.sql) e o padrão
-- DISTINCT ON (id_pedido) já usado em obter_kpis_vendas/obter_vendas_por_canal pra
-- desduplicar o cabeçalho do pedido, que vem denormalizado por item em pedidos_vendas.
--
-- Nome/documento do cliente vêm denormalizados no próprio pedido (snapshot de quando a
-- venda foi feita); cidade/UF/telefone/email vêm de um LEFT JOIN com a dimensão
-- barbers.contatos (dado atual do cadastro) — mesmo padrão de produtos/categoria.

-- CREATE OR REPLACE só substitui uma função de mesma assinatura — como estamos inserindo
-- p_uf/p_cidade no meio da lista de parâmetros, a assinatura antiga vira uma sobrecarga
-- órfã se não for removida explicitamente.
DROP FUNCTION IF EXISTS obter_relatorio_vendas_clientes(TEXT, DATE, DATE, BIGINT[], TEXT, TEXT, TEXT, INTEGER, INTEGER);

-- Adiciona data_nascimento ao retorno — muda o tipo composto de retorno, então precisa
-- dropar a versão anterior (mesma assinatura de parâmetros) antes do CREATE OR REPLACE.
DROP FUNCTION IF EXISTS obter_relatorio_vendas_clientes(TEXT, DATE, DATE, BIGINT[], TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION obter_relatorio_vendas_clientes(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE,
    p_canais BIGINT[] DEFAULT NULL,
    p_busca TEXT DEFAULT NULL,
    p_uf TEXT DEFAULT NULL,              -- NULL = "Todos"; valor deve bater com obter_ufs_clientes()
    p_cidade TEXT DEFAULT NULL,          -- NULL = "Todos"; valor deve bater com obter_municipios_clientes()
    p_ordenar_por TEXT DEFAULT 'valor_vendido', -- 'valor_vendido' | 'qtde_pedidos' | 'ticket_medio'
    p_ordenar_direcao TEXT DEFAULT 'desc',      -- 'asc' | 'desc'
    p_pagina INTEGER DEFAULT 1,
    p_tamanho_pagina INTEGER DEFAULT 50
)
RETURNS TABLE(
    id_contato BIGINT,
    nome_contato TEXT,
    documento_contato TEXT,
    tipo_pessoa_contato TEXT,
    municipio TEXT,
    uf TEXT,
    telefone TEXT,
    email TEXT,
    data_nascimento DATE,
    total_pedidos BIGINT,
    unidades_vendidas NUMERIC,
    faturamento NUMERIC,
    ticket_medio NUMERIC,
    ultima_compra DATE,
    status_cliente TEXT, -- 'Novo' | 'Recorrente' | 'Não identificado'
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
        WHEN 'qtde_pedidos' THEN 'total_pedidos'
        WHEN 'ticket_medio' THEN 'ticket_medio'
        ELSE 'faturamento'
    END;
    v_ordenar_direcao := CASE lower(p_ordenar_direcao) WHEN 'asc' THEN 'ASC' ELSE 'DESC' END;
    v_busca_pattern := CASE WHEN p_busca IS NULL OR trim(p_busca) = '' THEN NULL ELSE '%' || trim(p_busca) || '%' END;
    v_offset := (GREATEST(p_pagina, 1) - 1) * GREATEST(p_tamanho_pagina, 1);

    v_sql := format('
        WITH pedidos_periodo AS (
            SELECT DISTINCT ON (pv.id_pedido)
                pv.id_pedido, pv.id_contato, pv.nome_contato, pv.documento_contato,
                pv.tipo_pessoa_contato, pv.total, pv.data
            FROM %I.pedidos_vendas pv
            LEFT JOIN %I.contatos c ON c.id_contato = pv.id_contato
            WHERE pv.data BETWEEN %L AND %L
              AND (%L::BIGINT[] IS NULL OR pv.id_loja = ANY(%L::BIGINT[]))
              AND pv.id_situacao = ANY(situacoes_validas_faturamento())
              AND (
                    %L::TEXT IS NULL
                 OR pv.nome_contato ILIKE %L
                 OR pv.documento_contato ILIKE %L
              )
              AND (%L::TEXT IS NULL OR c.uf = %L)
              AND (%L::TEXT IS NULL OR c.municipio = %L)
            ORDER BY pv.id_pedido
        ),
        itens_por_pedido AS (
            SELECT pv.id_pedido, sum(pv.quantidade_item) AS qtd
            FROM %I.pedidos_vendas pv
            JOIN pedidos_periodo pp ON pp.id_pedido = pv.id_pedido
            GROUP BY pv.id_pedido
        ),
        -- Cliente "Recorrente" = já tinha pelo menos 1 pedido válido ANTES do início do
        -- período filtrado (compara contra o histórico completo, não só o período em tela).
        compras_anteriores AS (
            SELECT DISTINCT pv.id_contato
            FROM %I.pedidos_vendas pv
            WHERE pv.data < %L
              AND pv.id_situacao = ANY(situacoes_validas_faturamento())
              AND pv.id_contato IS NOT NULL
        ),
        agrupado AS (
            SELECT
                pp.id_contato,
                MIN(pp.nome_contato)::TEXT AS nome_contato,
                MIN(pp.documento_contato)::TEXT AS documento_contato,
                MIN(pp.tipo_pessoa_contato)::TEXT AS tipo_pessoa_contato,
                count(*)::BIGINT AS total_pedidos,
                COALESCE(sum(ipp.qtd), 0)::NUMERIC AS unidades_vendidas,
                sum(pp.total)::NUMERIC AS faturamento,
                (sum(pp.total) / count(*))::NUMERIC AS ticket_medio,
                max(pp.data)::DATE AS ultima_compra
            FROM pedidos_periodo pp
            LEFT JOIN itens_por_pedido ipp ON ipp.id_pedido = pp.id_pedido
            GROUP BY pp.id_contato,
                     (CASE WHEN pp.id_contato IS NULL THEN COALESCE(pp.documento_contato, pp.nome_contato) END)
        )
        SELECT
            a.id_contato,
            a.nome_contato,
            a.documento_contato,
            a.tipo_pessoa_contato,
            c.municipio::TEXT AS municipio,
            c.uf::TEXT AS uf,
            COALESCE(c.celular, c.telefone)::TEXT AS telefone, -- celular é quem tem WhatsApp
            c.email::TEXT AS email,
            c.data_nascimento,
            a.total_pedidos,
            a.unidades_vendidas,
            a.faturamento,
            a.ticket_medio,
            a.ultima_compra,
            CASE
                WHEN a.id_contato IS NULL THEN ''Não identificado''
                WHEN a.id_contato IN (SELECT id_contato FROM compras_anteriores) THEN ''Recorrente''
                ELSE ''Novo''
            END AS status_cliente,
            count(*) OVER()::BIGINT AS total_registros
        FROM agrupado a
        LEFT JOIN %I.contatos c ON c.id_contato = a.id_contato
        ORDER BY %I %s NULLS LAST
        LIMIT %L OFFSET %L
    ', p_schema_name, p_schema_name,
       p_data_inicial, p_data_final, p_canais, p_canais,
       v_busca_pattern, v_busca_pattern, v_busca_pattern,
       p_uf, p_uf, p_cidade, p_cidade,
       p_schema_name,
       p_schema_name, p_data_inicial,
       p_schema_name,
       v_ordenar_coluna, v_ordenar_direcao, p_tamanho_pagina, v_offset);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_relatorio_vendas_clientes(TEXT, DATE, DATE, BIGINT[], TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;


-- Listas pra popular os filtros de UF/cidade (mesmo padrão de obter_marcas_produtos):
-- vêm da dimensão contatos inteira, não do período filtrado. Município é opcionalmente
-- restrito por UF (filtro em cascata — evita listar cidade de outro estado).
CREATE OR REPLACE FUNCTION obter_ufs_clientes(p_schema_name TEXT)
RETURNS TABLE(uf TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT DISTINCT uf::TEXT
        FROM %I.contatos
        WHERE uf IS NOT NULL AND trim(uf) <> ''''
        ORDER BY 1
    ', p_schema_name);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_ufs_clientes(TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION obter_municipios_clientes(p_schema_name TEXT, p_uf TEXT DEFAULT NULL)
RETURNS TABLE(municipio TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT DISTINCT municipio::TEXT
        FROM %I.contatos
        WHERE municipio IS NOT NULL AND trim(municipio) <> ''''
          AND (%L::TEXT IS NULL OR uf = %L)
        ORDER BY 1
    ', p_schema_name, p_uf, p_uf);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_municipios_clientes(TEXT, TEXT) TO authenticated;


-- Curva ABC de clientes: classifica cada cliente em A/B/C pelo faturamento acumulado
-- (A = clientes cujo acumulado ANTES deles ainda é < 80%, B = < 95%, C = restante).
-- Mesma lógica de obter_curva_abc_categorias (sql/rpc_relatorio_produtos.sql) — usar o
-- acumulado "antes da linha" evita o caso clássico de um único cliente com >80% de
-- participação virar B por causa do próprio acumulado dele mesmo.
-- p_limite corta a listagem retornada (evita centenas de linhas na tela), mas o
-- faturamento_total e o % acumulado são calculados sobre TODOS os clientes do período,
-- não só os retornados — senão o corte distorceria a curva.
CREATE OR REPLACE FUNCTION obter_curva_abc_clientes(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE,
    p_canais BIGINT[] DEFAULT NULL,
    p_uf TEXT DEFAULT NULL,
    p_cidade TEXT DEFAULT NULL,
    p_limite INTEGER DEFAULT 50
)
RETURNS TABLE(
    id_contato BIGINT,
    nome_contato TEXT,
    documento_contato TEXT,
    total_pedidos BIGINT,
    faturamento NUMERIC,
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
        WITH pedidos_periodo AS (
            SELECT DISTINCT ON (pv.id_pedido)
                pv.id_pedido, pv.id_contato, pv.nome_contato, pv.documento_contato, pv.total
            FROM %I.pedidos_vendas pv
            LEFT JOIN %I.contatos c ON c.id_contato = pv.id_contato
            WHERE pv.data BETWEEN %L AND %L
              AND (%L::BIGINT[] IS NULL OR pv.id_loja = ANY(%L::BIGINT[]))
              AND pv.id_situacao = ANY(situacoes_validas_faturamento())
              AND (%L::TEXT IS NULL OR c.uf = %L)
              AND (%L::TEXT IS NULL OR c.municipio = %L)
            ORDER BY pv.id_pedido
        ),
        por_cliente AS (
            SELECT
                id_contato,
                MIN(nome_contato)::TEXT AS nome_contato,
                MIN(documento_contato)::TEXT AS documento_contato,
                count(*)::BIGINT AS total_pedidos,
                sum(total)::NUMERIC AS faturamento
            FROM pedidos_periodo
            GROUP BY id_contato,
                     (CASE WHEN id_contato IS NULL THEN COALESCE(documento_contato, nome_contato) END)
        ),
        total AS (
            SELECT COALESCE(sum(faturamento), 0) AS faturamento_total FROM por_cliente
        ),
        acumulado AS (
            SELECT
                pc.*,
                sum(pc.faturamento) OVER (ORDER BY pc.faturamento DESC ROWS UNBOUNDED PRECEDING) AS faturamento_acumulado,
                sum(pc.faturamento) OVER (ORDER BY pc.faturamento DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS faturamento_acumulado_anterior
            FROM por_cliente pc
        )
        SELECT
            a.id_contato,
            a.nome_contato,
            a.documento_contato,
            a.total_pedidos,
            a.faturamento,
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
        LIMIT %L
    ', p_schema_name, p_schema_name,
       p_data_inicial, p_data_final, p_canais, p_canais,
       p_uf, p_uf, p_cidade, p_cidade,
       p_limite);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_curva_abc_clientes(TEXT, DATE, DATE, BIGINT[], TEXT, TEXT, INTEGER) TO authenticated;
