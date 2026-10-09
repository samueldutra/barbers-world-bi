-- Camada de dados do dashboard de vendas. Regras de negócio centralizadas aqui (nunca no
-- frontend) — ver requisitos funcionais seção 46.

-- Situações do Bling que contam como venda válida (catálogo real:
-- GET /situacoes/modulos/98310 na conta da Barbers World).
--   9 = Atendido
-- Todas as outras (Em aberto=6 e suas ~10 variações internas — Fornecedor, CARRO
-- MATHEUS/RODRIGO, Eventos/Workshop, cliente leandro, funcionarios, VENDA LOJA, parceria
-- — mais Em andamento=15) são pedidos AINDA NÃO CONFIRMADOS, não vendas fechadas.
-- Validado cruzando com o próprio relatório do Bling (Pedidos de venda filtrado por
-- Situação: Atendido) para os últimos 30 dias: bateu R$ 340.989 (nosso, recomputado por
-- item) vs R$ 339.344 (Bling, total do pedido) — a lista antiga (excluía só
-- Cancelado/Devolução) inflava o faturamento em mais de 3x, contando coisas como
-- "Eventos/Workshop" (R$ 516k) como se fossem vendas.
--
-- É o FILTRO PADRÃO de situações do dashboard: as RPCs abaixo recebem p_situacoes
-- (BIGINT[]) e, quando NULL, caem nesta lista. Para mudar o padrão de todo o BI (dashboard,
-- relatórios, conferência de preços), altere só esta função.
CREATE OR REPLACE FUNCTION situacoes_validas_faturamento()
RETURNS BIGINT[]
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT ARRAY[9]::BIGINT[];
$$;

-- FILTRO PADRÃO DO DASHBOARD (só as telas do dashboard — os relatórios continuam em
-- situacoes_validas_faturamento()): todas as situações já vistas, MENOS Cancelado (12),
-- Em aberto (6) e as situações personalizadas que herdam de Em aberto (Fornecedor,
-- Eventos/Workshop, CARRO MATHEUS, Devolução...). Calculada no banco, então uma situação
-- nova criada no Bling entra sozinha, a menos que herde de Em aberto.
CREATE OR REPLACE FUNCTION situacoes_padrao_dashboard(p_schema_name TEXT)
RETURNS BIGINT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ids BIGINT[];
BEGIN
    -- "Loose index scan": os ids de situação vistos nos pedidos são achados com ~1 sonda no índice
    -- por valor distinto (cerca de 25), em vez de ler as ~95 mil entradas do índice (DISTINCT) —
    -- de ~31 ms para <1 ms por chamada (o dashboard chama isso ~9x por carga).
    EXECUTE format('
        WITH RECURSIVE vistas AS (
            (SELECT id_situacao FROM %1$I.pedidos_vendas WHERE id_situacao IS NOT NULL ORDER BY id_situacao LIMIT 1)
            UNION ALL
            SELECT (SELECT p.id_situacao FROM %1$I.pedidos_vendas p WHERE p.id_situacao > v.id_situacao ORDER BY p.id_situacao LIMIT 1)
            FROM vistas v WHERE v.id_situacao IS NOT NULL
        ),
        ids AS (
            SELECT id_situacao::BIGINT AS id_situacao FROM vistas WHERE id_situacao IS NOT NULL
            UNION
            SELECT id_situacao::BIGINT FROM %1$I.situacoes_pedido
        )
        SELECT COALESCE(array_agg(ids.id_situacao ORDER BY ids.id_situacao), ARRAY[]::BIGINT[])
        FROM ids
        LEFT JOIN %1$I.situacoes_pedido s ON s.id_situacao = ids.id_situacao
        WHERE ids.id_situacao NOT IN (12, 6)
          AND COALESCE(s.id_herdado, 0) <> 6
    ', p_schema_name)
    INTO v_ids;

    RETURN v_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION situacoes_padrao_dashboard(TEXT) TO authenticated;

-- Situações que contam como cancelamento (métrica separada — seção 5.8).
--   12      = Cancelado
--   453477  = Devolução
CREATE OR REPLACE FUNCTION situacoes_canceladas_faturamento()
RETURNS BIGINT[]
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT ARRAY[12, 453477]::BIGINT[];
$$;


-- KPIs consolidados do período (faturamento, pedidos, itens, ticket médio, itens/pedido,
-- desconto, cancelamentos). Uma linha por chamada — o frontend chama 2x (período atual e
-- período de comparação) e calcula a variação percentual no cliente.
-- p_situacoes: situações que contam como venda (NULL = situacoes_padrao_dashboard()).
-- Cancelamentos são sempre medidos pelas situacoes_canceladas_faturamento(), independente
-- do filtro.
DROP FUNCTION IF EXISTS obter_kpis_vendas(TEXT, DATE, DATE, BIGINT[]);
CREATE OR REPLACE FUNCTION obter_kpis_vendas(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE,
    p_canais BIGINT[] DEFAULT NULL,
    p_situacoes BIGINT[] DEFAULT NULL
)
RETURNS TABLE(
    faturamento_bruto NUMERIC,
    total_pedidos BIGINT,
    total_itens BIGINT,
    ticket_medio NUMERIC,
    itens_por_pedido NUMERIC,
    desconto_total NUMERIC,
    valor_cancelado NUMERIC,
    pedidos_cancelados BIGINT
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
            SELECT DISTINCT ON (id_pedido)
                id_pedido, id_loja, id_situacao, total, desconto_valor, desconto_unidade
            FROM %I.pedidos_vendas
            WHERE data BETWEEN %L AND %L
              AND (%L::BIGINT[] IS NULL OR id_loja = ANY(%L::BIGINT[]))
            ORDER BY id_pedido
        ),
        itens_periodo AS (
            SELECT id_pedido, quantidade_item
            FROM %I.pedidos_vendas
            WHERE data BETWEEN %L AND %L
              AND (%L::BIGINT[] IS NULL OR id_loja = ANY(%L::BIGINT[]))
        ),
        validos AS (
            SELECT * FROM pedidos_periodo WHERE id_situacao = ANY(COALESCE(%L::BIGINT[], situacoes_validas_faturamento()))
        ),
        cancelados AS (
            SELECT * FROM pedidos_periodo WHERE id_situacao = ANY(situacoes_canceladas_faturamento())
        ),
        itens_validos AS (
            SELECT ip.quantidade_item FROM itens_periodo ip JOIN validos v ON v.id_pedido = ip.id_pedido
        )
        SELECT
            COALESCE((SELECT sum(total) FROM validos), 0)::NUMERIC,
            (SELECT count(*) FROM validos)::BIGINT,
            COALESCE((SELECT sum(quantidade_item) FROM itens_validos), 0)::BIGINT,
            CASE WHEN (SELECT count(*) FROM validos) > 0
                 THEN (SELECT sum(total) FROM validos) / (SELECT count(*) FROM validos)
                 ELSE 0 END::NUMERIC,
            CASE WHEN (SELECT count(*) FROM validos) > 0
                 THEN (SELECT sum(quantidade_item) FROM itens_validos) / (SELECT count(*) FROM validos)
                 ELSE 0 END::NUMERIC,
            COALESCE((SELECT sum(desconto_valor) FROM validos WHERE desconto_unidade = ''REAL''), 0)::NUMERIC,
            COALESCE((SELECT sum(total) FROM cancelados), 0)::NUMERIC,
            (SELECT count(*) FROM cancelados)::BIGINT
    ', p_schema_name, p_data_inicial, p_data_final, p_canais, p_canais,
       p_schema_name, p_data_inicial, p_data_final, p_canais, p_canais,
       COALESCE(p_situacoes, situacoes_padrao_dashboard(p_schema_name)));

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_kpis_vendas(TEXT, DATE, DATE, BIGINT[], BIGINT[]) TO authenticated;


-- Série diária (faturamento, pedidos, itens, ticket médio) para o gráfico de evolução.
DROP FUNCTION IF EXISTS obter_evolucao_vendas(TEXT, DATE, DATE, BIGINT[]);
CREATE OR REPLACE FUNCTION obter_evolucao_vendas(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE,
    p_canais BIGINT[] DEFAULT NULL,
    p_situacoes BIGINT[] DEFAULT NULL
)
RETURNS TABLE(
    dia DATE,
    faturamento NUMERIC,
    pedidos BIGINT,
    itens BIGINT,
    ticket_medio NUMERIC
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
            SELECT DISTINCT ON (id_pedido)
                id_pedido, data, id_situacao, total
            FROM %I.pedidos_vendas
            WHERE data BETWEEN %L AND %L
              AND (%L::BIGINT[] IS NULL OR id_loja = ANY(%L::BIGINT[]))
              AND id_situacao = ANY(COALESCE(%L::BIGINT[], situacoes_validas_faturamento()))
            ORDER BY id_pedido
        ),
        itens_por_pedido AS (
            SELECT pv.id_pedido, sum(pv.quantidade_item) AS qtd
            FROM %I.pedidos_vendas pv
            JOIN pedidos_periodo p ON p.id_pedido = pv.id_pedido
            GROUP BY pv.id_pedido
        )
        SELECT
            pp.data::DATE AS dia,
            sum(pp.total)::NUMERIC AS faturamento,
            count(*)::BIGINT AS pedidos,
            COALESCE(sum(ipp.qtd), 0)::BIGINT AS itens,
            (sum(pp.total) / count(*))::NUMERIC AS ticket_medio
        FROM pedidos_periodo pp
        LEFT JOIN itens_por_pedido ipp ON ipp.id_pedido = pp.id_pedido
        GROUP BY pp.data
        ORDER BY pp.data
    ', p_schema_name, p_data_inicial, p_data_final, p_canais, p_canais, COALESCE(p_situacoes, situacoes_padrao_dashboard(p_schema_name)), p_schema_name);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_evolucao_vendas(TEXT, DATE, DATE, BIGINT[], BIGINT[]) TO authenticated;


-- Vendas por canal — usa pedido.total (não recomputa por item) e considera as situações de
-- p_situacoes (NULL = situacoes_padrao_dashboard()).
DROP FUNCTION IF EXISTS obter_vendas_por_canal(TEXT, DATE, DATE);
CREATE OR REPLACE FUNCTION obter_vendas_por_canal(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE,
    p_situacoes BIGINT[] DEFAULT NULL
)
RETURNS TABLE(
    id_loja BIGINT,
    canal_descricao TEXT,
    canal_grupo TEXT,
    total_pedidos BIGINT,
    total_itens BIGINT,
    faturamento NUMERIC
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
            SELECT DISTINCT ON (id_pedido)
                id_pedido, id_loja, total
            FROM %I.pedidos_vendas
            WHERE data BETWEEN %L AND %L
              AND id_situacao = ANY(COALESCE(%L::BIGINT[], situacoes_validas_faturamento()))
            ORDER BY id_pedido
        ),
        itens_periodo AS (
            SELECT pv.id_pedido, pv.id_loja, pv.quantidade_item
            FROM %I.pedidos_vendas pv
            JOIN pedidos_periodo p ON p.id_pedido = pv.id_pedido
        )
        SELECT
            pp.id_loja,
            cv.descricao::TEXT,
            cv.grupo::TEXT,
            count(DISTINCT pp.id_pedido)::BIGINT AS total_pedidos,
            COALESCE((SELECT sum(ip.quantidade_item) FROM itens_periodo ip WHERE ip.id_loja = pp.id_loja), 0)::BIGINT AS total_itens,
            sum(pp.total)::NUMERIC AS faturamento
        FROM pedidos_periodo pp
        LEFT JOIN %I.canais_venda cv ON cv.id_loja = pp.id_loja
        GROUP BY pp.id_loja, cv.descricao, cv.grupo
        ORDER BY faturamento DESC NULLS LAST
    ', p_schema_name, p_data_inicial, p_data_final, COALESCE(p_situacoes, situacoes_padrao_dashboard(p_schema_name)), p_schema_name, p_schema_name);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_vendas_por_canal(TEXT, DATE, DATE, BIGINT[]) TO authenticated;


-- Lista de canais pra popular o filtro multiseleção (seção 4.2). Schema barbers não é
-- exposto no PostgREST, então o frontend não consegue ler canais_venda direto — passa
-- por essa RPC.
CREATE OR REPLACE FUNCTION obter_canais_venda(p_schema_name TEXT)
RETURNS TABLE(id_loja BIGINT, descricao TEXT, grupo TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT id_loja, descricao::TEXT, grupo::TEXT
        FROM %I.canais_venda
        ORDER BY descricao
    ', p_schema_name);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_canais_venda(TEXT) TO authenticated;


-- Situações pra popular o filtro multiseleção do dashboard: TODAS as que já apareceram em
-- algum pedido (mesmo sem nome sincronizado ainda) + as do padrão, com volume no período
-- filtrado (datas/canais) pra ajudar a decidir o que incluir. Nome vem de
-- situacoes_pedido (sync-situacoes-bling.py); sem sync, cai em "Situação <id>".
CREATE OR REPLACE FUNCTION obter_situacoes_pedido(
    p_schema_name TEXT,
    p_data_inicial DATE DEFAULT NULL,
    p_data_final DATE DEFAULT NULL,
    p_canais BIGINT[] DEFAULT NULL
)
RETURNS TABLE(
    id_situacao BIGINT,
    nome TEXT,
    cor TEXT,
    nome_herdado TEXT,
    padrao BOOLEAN,
    cancelamento BOOLEAN,
    pedidos_periodo BIGINT,
    valor_periodo NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        WITH RECURSIVE vistas AS (
            -- ids de situação vistos nos pedidos, por "loose index scan" (~1 sonda por valor distinto)
            (SELECT id_situacao FROM %1$I.pedidos_vendas WHERE id_situacao IS NOT NULL ORDER BY id_situacao LIMIT 1)
            UNION ALL
            SELECT (SELECT p.id_situacao FROM %1$I.pedidos_vendas p WHERE p.id_situacao > v.id_situacao ORDER BY p.id_situacao LIMIT 1)
            FROM vistas v WHERE v.id_situacao IS NOT NULL
        ),
        ids AS (
            SELECT id_situacao::BIGINT AS id_situacao FROM vistas WHERE id_situacao IS NOT NULL
            UNION
            SELECT unnest(situacoes_validas_faturamento())
        ),
        pedidos_periodo AS (
            SELECT DISTINCT ON (id_pedido) id_pedido, id_situacao::BIGINT AS id_situacao, total
            FROM %1$I.pedidos_vendas
            WHERE (%2$L::DATE IS NULL OR data >= %2$L::DATE)
              AND (%3$L::DATE IS NULL OR data <= %3$L::DATE)
              AND (%4$L::BIGINT[] IS NULL OR id_loja = ANY(%4$L::BIGINT[]))
            ORDER BY id_pedido
        ),
        volume AS (
            SELECT id_situacao, count(*) AS pedidos, sum(total) AS valor
            FROM pedidos_periodo
            GROUP BY id_situacao
        ),
        -- Calculado UMA vez (na lista do SELECT ele rodaria uma vez por linha: ~870 ms no total).
        padrao AS (
            SELECT situacoes_padrao_dashboard(%1$L) AS ids
        )
        SELECT
            ids.id_situacao,
            COALESCE(s.nome, ''Situação '' || ids.id_situacao)::TEXT,
            s.cor::TEXT,
            h.nome::TEXT,
            ids.id_situacao = ANY(padrao.ids),
            ids.id_situacao = ANY(situacoes_canceladas_faturamento()),
            COALESCE(v.pedidos, 0)::BIGINT,
            COALESCE(v.valor, 0)::NUMERIC
        FROM ids
        CROSS JOIN padrao
        LEFT JOIN %1$I.situacoes_pedido s ON s.id_situacao = ids.id_situacao
        LEFT JOIN %1$I.situacoes_pedido h ON h.id_situacao = NULLIF(s.id_herdado, 0)
        LEFT JOIN volume v ON v.id_situacao = ids.id_situacao
        ORDER BY COALESCE(v.pedidos, 0) DESC, 2
    ', p_schema_name, p_data_inicial, p_data_final, p_canais);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_situacoes_pedido(TEXT, DATE, DATE, BIGINT[]) TO authenticated;


-- A função antiga virou uma armadilha (nome sugere "só exclui cancelado", mas isso
-- estava inflando o faturamento 3x) — removida pra ninguém mais chamar sem querer.
DROP FUNCTION IF EXISTS situacoes_excluidas_faturamento();
