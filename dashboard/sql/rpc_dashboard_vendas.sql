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
CREATE OR REPLACE FUNCTION situacoes_validas_faturamento()
RETURNS BIGINT[]
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT ARRAY[9]::BIGINT[];
$$;

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
CREATE OR REPLACE FUNCTION obter_kpis_vendas(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE,
    p_canais BIGINT[] DEFAULT NULL
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
            SELECT * FROM pedidos_periodo WHERE id_situacao = ANY(situacoes_validas_faturamento())
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
       p_schema_name, p_data_inicial, p_data_final, p_canais, p_canais);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_kpis_vendas(TEXT, DATE, DATE, BIGINT[]) TO authenticated;


-- Série diária (faturamento, pedidos, itens, ticket médio) para o gráfico de evolução.
CREATE OR REPLACE FUNCTION obter_evolucao_vendas(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE,
    p_canais BIGINT[] DEFAULT NULL
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
              AND id_situacao = ANY(situacoes_validas_faturamento())
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
    ', p_schema_name, p_data_inicial, p_data_final, p_canais, p_canais, p_schema_name);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_evolucao_vendas(TEXT, DATE, DATE, BIGINT[]) TO authenticated;


-- Vendas por canal — usa pedido.total (não recomputa por item) e só considera
-- id_situacao = Atendido (situacoes_validas_faturamento()).
CREATE OR REPLACE FUNCTION obter_vendas_por_canal(
    p_schema_name TEXT,
    p_data_inicial DATE,
    p_data_final DATE
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
              AND id_situacao = ANY(situacoes_validas_faturamento())
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
    ', p_schema_name, p_data_inicial, p_data_final, p_schema_name, p_schema_name);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_vendas_por_canal(TEXT, DATE, DATE) TO authenticated;


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


-- A função antiga virou uma armadilha (nome sugere "só exclui cancelado", mas isso
-- estava inflando o faturamento 3x) — removida pra ninguém mais chamar sem querer.
DROP FUNCTION IF EXISTS situacoes_excluidas_faturamento();
