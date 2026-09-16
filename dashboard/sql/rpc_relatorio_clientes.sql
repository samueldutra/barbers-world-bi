-- Módulo "Relatório de Vendas por Cliente": listagem paginada/buscável (ordenável por
-- valor vendido, qtde de pedidos, ticket médio ou última compra), filtrável por cidade,
-- com marcação novo x recorrente, + curva ABC de clientes. Reaproveita
-- situacoes_validas_faturamento() (sql/rpc_dashboard_vendas.sql) e o padrão
-- DISTINCT ON (id_pedido) já usado em obter_kpis_vendas/obter_vendas_por_canal pra
-- desduplicar o cabeçalho do pedido, que vem denormalizado por item em pedidos_vendas.
--
-- Nome/documento do cliente vêm denormalizados no próprio pedido (snapshot de quando a
-- venda foi feita); cidade/UF/telefone/email/aniversário vêm de um LEFT JOIN com a
-- dimensão barbers.contatos (dado atual do cadastro) — mesmo padrão de produtos/categoria.
--
-- Filtro de "última compra" (p_ultima_compra_antes_de): pensado pra achar cliente sumido
-- e entrar em contato. Quando preenchido, o cliente entra na lista mesmo com ZERO pedido
-- no período selecionado — por isso a base da consulta é o histórico COMPLETO do cliente
-- (todos_pedidos/por_cliente_geral), não só o período; o período (p_data_inicial/final)
-- continua controlando só as colunas de pedidos/faturamento/ticket médio exibidas.

-- CREATE OR REPLACE só substitui uma função de mesma assinatura — como estamos tirando
-- p_uf e trocando de posição/tipo os parâmetros, a assinatura antiga vira uma sobrecarga
-- órfã se não for removida explicitamente.
DROP FUNCTION IF EXISTS obter_relatorio_vendas_clientes(TEXT, DATE, DATE, BIGINT[], TEXT, TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS obter_relatorio_vendas_clientes(TEXT, DATE, DATE, BIGINT[], TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS obter_relatorio_vendas_clientes(TEXT, DATE, DATE, BIGINT[], TEXT, TEXT, DATE, TEXT, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION obter_relatorio_vendas_clientes(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE,
    p_canais BIGINT[] DEFAULT NULL,
    p_busca TEXT DEFAULT NULL,
    p_cidade TEXT DEFAULT NULL,                 -- NULL = "Todos"; valor deve bater com obter_municipios_clientes()
    p_ultima_compra_antes_de DATE DEFAULT NULL,  -- preenchido = traz cliente com última compra (histórico completo) nessa data ou antes, mesmo sem pedido no período
    p_incluir_sem_venda BOOLEAN DEFAULT TRUE,    -- TRUE (default) = mantém no relatório o cliente com histórico mas sem pedido no período (aparece com 0/zerado); FALSE = só cliente com pedido > 0 no período
    p_ordenar_por TEXT DEFAULT 'valor_vendido',  -- 'valor_vendido' | 'qtde_pedidos' | 'ticket_medio' | 'ultima_compra'
    p_ordenar_direcao TEXT DEFAULT 'desc',       -- 'asc' | 'desc'
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
        WHEN 'ultima_compra' THEN 'ultima_compra'
        ELSE 'faturamento'
    END;
    v_ordenar_direcao := CASE lower(p_ordenar_direcao) WHEN 'asc' THEN 'ASC' ELSE 'DESC' END;
    v_busca_pattern := CASE WHEN p_busca IS NULL OR trim(p_busca) = '' THEN NULL ELSE '%' || trim(p_busca) || '%' END;
    v_offset := (GREATEST(p_pagina, 1) - 1) * GREATEST(p_tamanho_pagina, 1);

    v_sql := format('
        WITH todos_pedidos AS (
            -- Histórico completo do cliente (sem limitar ao período) — usado pra achar a
            -- última compra de verdade e pra incluir cliente sumido quando o filtro de
            -- última compra estiver ativo, mesmo sem pedido nenhum no período em tela.
            SELECT DISTINCT ON (pv.id_pedido)
                pv.id_pedido, pv.id_contato, pv.nome_contato, pv.documento_contato,
                pv.tipo_pessoa_contato, pv.total, pv.data
            FROM %I.pedidos_vendas pv
            LEFT JOIN %I.contatos c ON c.id_contato = pv.id_contato
            WHERE pv.id_situacao = ANY(situacoes_validas_faturamento())
              AND (%L::BIGINT[] IS NULL OR pv.id_loja = ANY(%L::BIGINT[]))
              AND (
                    %L::TEXT IS NULL
                 OR pv.nome_contato ILIKE %L
                 OR pv.documento_contato ILIKE %L
              )
              AND (%L::TEXT IS NULL OR c.municipio = %L)
            ORDER BY pv.id_pedido
        ),
        por_cliente_geral AS (
            SELECT
                id_contato,
                (CASE WHEN id_contato IS NULL THEN COALESCE(documento_contato, nome_contato) END) AS chave_manual,
                MIN(nome_contato)::TEXT AS nome_contato,
                MIN(documento_contato)::TEXT AS documento_contato,
                MIN(tipo_pessoa_contato)::TEXT AS tipo_pessoa_contato,
                max(data)::DATE AS ultima_compra
            FROM todos_pedidos
            GROUP BY id_contato, (CASE WHEN id_contato IS NULL THEN COALESCE(documento_contato, nome_contato) END)
        ),
        -- Cliente "Recorrente" = já tinha pelo menos 1 pedido válido ANTES do início do
        -- período filtrado (compara contra o histórico completo, não só o período em tela).
        compras_anteriores AS (
            SELECT DISTINCT id_contato
            FROM todos_pedidos
            WHERE data < %L
              AND id_contato IS NOT NULL
        ),
        pedidos_periodo AS (
            SELECT * FROM todos_pedidos WHERE data BETWEEN %L AND %L
        ),
        itens_por_pedido AS (
            SELECT pv.id_pedido, sum(pv.quantidade_item) AS qtd
            FROM %I.pedidos_vendas pv
            JOIN pedidos_periodo pp ON pp.id_pedido = pv.id_pedido
            GROUP BY pv.id_pedido
        ),
        agrupado_periodo AS (
            SELECT
                pp.id_contato,
                (CASE WHEN pp.id_contato IS NULL THEN COALESCE(pp.documento_contato, pp.nome_contato) END) AS chave_manual,
                count(*)::BIGINT AS total_pedidos,
                COALESCE(sum(ipp.qtd), 0)::NUMERIC AS unidades_vendidas,
                sum(pp.total)::NUMERIC AS faturamento,
                (sum(pp.total) / count(*))::NUMERIC AS ticket_medio
            FROM pedidos_periodo pp
            LEFT JOIN itens_por_pedido ipp ON ipp.id_pedido = pp.id_pedido
            GROUP BY pp.id_contato,
                     (CASE WHEN pp.id_contato IS NULL THEN COALESCE(pp.documento_contato, pp.nome_contato) END)
        )
        SELECT
            pcg.id_contato,
            pcg.nome_contato,
            pcg.documento_contato,
            pcg.tipo_pessoa_contato,
            c.municipio::TEXT AS municipio,
            c.uf::TEXT AS uf,
            COALESCE(c.celular, c.telefone)::TEXT AS telefone, -- celular é quem tem WhatsApp
            c.email::TEXT AS email,
            c.data_nascimento,
            COALESCE(ap.total_pedidos, 0)::BIGINT AS total_pedidos,
            COALESCE(ap.unidades_vendidas, 0)::NUMERIC AS unidades_vendidas,
            COALESCE(ap.faturamento, 0)::NUMERIC AS faturamento,
            COALESCE(ap.ticket_medio, 0)::NUMERIC AS ticket_medio,
            pcg.ultima_compra,
            CASE
                WHEN pcg.id_contato IS NULL THEN ''Não identificado''
                WHEN pcg.id_contato IN (SELECT id_contato FROM compras_anteriores) THEN ''Recorrente''
                ELSE ''Novo''
            END AS status_cliente,
            count(*) OVER()::BIGINT AS total_registros
        FROM por_cliente_geral pcg
        LEFT JOIN agrupado_periodo ap
            ON ap.id_contato IS NOT DISTINCT FROM pcg.id_contato
           AND ap.chave_manual IS NOT DISTINCT FROM pcg.chave_manual
        LEFT JOIN %I.contatos c ON c.id_contato = pcg.id_contato
        WHERE
            CASE
                -- Checkbox desmarcado sempre exige pedido > 0 no período, mesmo com o
                -- filtro de última compra ativo (senão o checkbox vira "decorativo" quando
                -- combinado com ele, já que cliente sumido normalmente tem 0 pedido no
                -- período mesmo).
                WHEN NOT %L::BOOLEAN THEN ap.total_pedidos IS NOT NULL
                WHEN %L::DATE IS NOT NULL THEN pcg.ultima_compra <= %L::DATE
                ELSE TRUE
            END
        ORDER BY %I %s NULLS LAST
        LIMIT %L OFFSET %L
    ', p_schema_name, p_schema_name,
       p_canais, p_canais,
       v_busca_pattern, v_busca_pattern, v_busca_pattern,
       p_cidade, p_cidade,
       p_data_inicial,
       p_data_inicial, p_data_final,
       p_schema_name,
       p_schema_name,
       p_incluir_sem_venda,
       p_ultima_compra_antes_de, p_ultima_compra_antes_de,
       v_ordenar_coluna, v_ordenar_direcao, p_tamanho_pagina, v_offset);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_relatorio_vendas_clientes(TEXT, DATE, DATE, BIGINT[], TEXT, TEXT, DATE, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;


-- Lista pra popular o filtro de cidade (mesmo padrão de obter_marcas_produtos): vem da
-- dimensão contatos inteira, não do período filtrado. Sem filtro de UF (removido da
-- tela) — lista todos os municípios direto.
DROP FUNCTION IF EXISTS obter_ufs_clientes(TEXT);
DROP FUNCTION IF EXISTS obter_municipios_clientes(TEXT, TEXT);

CREATE OR REPLACE FUNCTION obter_municipios_clientes(p_schema_name TEXT)
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
        ORDER BY 1
    ', p_schema_name);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_municipios_clientes(TEXT) TO authenticated;


-- Curva ABC de clientes: classifica cada cliente em A/B/C pelo faturamento acumulado
-- (A = clientes cujo acumulado ANTES deles ainda é < 80%, B = < 95%, C = restante).
-- Mesma lógica de obter_curva_abc_categorias (sql/rpc_relatorio_produtos.sql) — usar o
-- acumulado "antes da linha" evita o caso clássico de um único cliente com >80% de
-- participação virar B por causa do próprio acumulado dele mesmo.
-- p_limite corta a listagem retornada (evita centenas de linhas na tela), mas o
-- faturamento_total e o % acumulado são calculados sobre TODOS os clientes do período,
-- não só os retornados — senão o corte distorceria a curva.
DROP FUNCTION IF EXISTS obter_curva_abc_clientes(TEXT, DATE, DATE, BIGINT[], TEXT, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION obter_curva_abc_clientes(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE,
    p_canais BIGINT[] DEFAULT NULL,
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
       p_cidade, p_cidade,
       p_limite);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_curva_abc_clientes(TEXT, DATE, DATE, BIGINT[], TEXT, INTEGER) TO authenticated;
