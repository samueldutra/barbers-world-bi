-- Confirmação do vínculo Bling × Nuvemshop POR ID, a partir dos pedidos: o pedido da Nuvemshop casa com o pedido
-- do Bling pelo número (pedidos_vendas.numero_loja = nuvemshop_pedidos.numero) e os itens se pareiam (1 item de
-- cada lado, ou quantidade + preço únicos no pedido). Cada par liga o id_produto do Bling ao id_variante da
-- Nuvemshop sem depender de SKU nem de nome. Só cobre o que já vendeu pela Nuvemshop; exige o backfill de
-- pedidos da Nuvemshop (workflow etl-hourly com alterados_horas=8760 e apenas_nuvemshop=true).

CREATE OR REPLACE VIEW barbers.vw_pares_id_bling_nuvemshop AS
WITH ped AS (
  SELECT DISTINCT pv.id_pedido AS id_pedido_bling, n.store_id, n.id_pedido AS id_pedido_ns
  FROM barbers.pedidos_vendas pv
  JOIN barbers.canais_venda cv ON cv.id_loja = pv.id_loja AND cv.grupo = 'Nuvemshop'
  JOIN barbers.nuvemshop_pedidos n ON pv.numero_loja ~ '^[0-9]+$' AND n.numero = pv.numero_loja::int
),
bi AS (
  SELECT p.id_pedido_bling, p.store_id, p.id_pedido_ns, pv.id_produto AS id_produto_bling, pv.codigo_item,
         pv.quantidade_item AS qtd, pv.valor_unitario_item AS valor,
         round(pv.valor_unitario_item / nullif(1 - coalesce(pv.desconto_item_percentual, 0) / 100, 0), 2) AS valor_cheio
  FROM ped p JOIN barbers.pedidos_vendas pv ON pv.id_pedido = p.id_pedido_bling
  WHERE pv.id_produto IS NOT NULL
),
ni AS (
  SELECT i.store_id, i.id_pedido AS id_pedido_ns, i.id_produto AS id_produto_ns, i.id_variante, i.sku, i.quantidade AS qtd, i.preco
  FROM barbers.nuvemshop_pedidos_itens i
),
cont AS (
  SELECT b.id_pedido_bling,
         (SELECT count(*) FROM bi x WHERE x.id_pedido_bling = b.id_pedido_bling) AS nb,
         (SELECT count(*) FROM ni y WHERE y.store_id = b.store_id AND y.id_pedido_ns = b.id_pedido_ns) AS nn
  FROM (SELECT DISTINCT id_pedido_bling, store_id, id_pedido_ns FROM bi) b
)
SELECT b.id_produto_bling, b.codigo_item, n.store_id, n.id_produto_ns, n.id_variante, n.sku, b.id_pedido_bling, n.id_pedido_ns, 'unico'::TEXT AS nivel
FROM bi b JOIN cont c USING (id_pedido_bling) JOIN ni n ON n.store_id = b.store_id AND n.id_pedido_ns = b.id_pedido_ns
WHERE c.nb = 1 AND c.nn = 1
UNION ALL
SELECT b.id_produto_bling, b.codigo_item, n.store_id, n.id_produto_ns, n.id_variante, n.sku, b.id_pedido_bling, n.id_pedido_ns, 'qtd_preco'
FROM bi b JOIN cont c USING (id_pedido_bling) JOIN ni n ON n.store_id = b.store_id AND n.id_pedido_ns = b.id_pedido_ns
WHERE NOT (c.nb = 1 AND c.nn = 1) AND b.qtd = n.qtd
  AND (abs(b.valor - n.preco) <= 0.02 OR abs(coalesce(b.valor_cheio, -1) - n.preco) <= 0.02)
  AND (SELECT count(*) FROM ni n2 WHERE n2.store_id = b.store_id AND n2.id_pedido_ns = b.id_pedido_ns AND n2.qtd = b.qtd
         AND (abs(b.valor - n2.preco) <= 0.02 OR abs(coalesce(b.valor_cheio, -1) - n2.preco) <= 0.02)) = 1
  AND (SELECT count(*) FROM bi b2 WHERE b2.id_pedido_bling = b.id_pedido_bling AND b2.qtd = n.qtd
         AND (abs(b2.valor - n.preco) <= 0.02 OR abs(coalesce(b2.valor_cheio, -1) - n.preco) <= 0.02)) = 1;

REVOKE ALL ON barbers.vw_pares_id_bling_nuvemshop FROM PUBLIC, anon, authenticated;

-- A view acima é cara (~10 s: recontagens correlacionadas por pedido), então o resultado é PERSISTIDO numa tabela e
-- as RPCs de leitura só consultam a tabela. A atualização roda no fim do etl-nuvemshop-pedidos (e na mão, se precisar).
CREATE TABLE IF NOT EXISTS barbers.pares_id_bling_nuvemshop (
    id_produto_bling  BIGINT NOT NULL,
    codigo_item       VARCHAR(100),
    store_id          BIGINT NOT NULL,
    id_produto_ns     BIGINT,
    id_variante       BIGINT NOT NULL,
    sku               VARCHAR(100),
    id_pedido_bling   BIGINT NOT NULL,
    id_pedido_ns      BIGINT NOT NULL,
    nivel             VARCHAR(10) NOT NULL,   -- 'unico' (1 item de cada lado) | 'qtd_preco'
    atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pares_id_variante ON barbers.pares_id_bling_nuvemshop (id_variante);
CREATE INDEX IF NOT EXISTS idx_pares_id_produto_bling ON barbers.pares_id_bling_nuvemshop (id_produto_bling);
ALTER TABLE barbers.pares_id_bling_nuvemshop ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION atualizar_pares_id_bling_nuvemshop(p_schema_name TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_linhas BIGINT;
BEGIN
    PERFORM public.assert_tenant_access(p_schema_name);
    IF p_schema_name IS NULL OR p_schema_name = '' THEN
        RAISE EXCEPTION 'Schema name é obrigatório';
    END IF;
    EXECUTE format('TRUNCATE %1$I.pares_id_bling_nuvemshop', p_schema_name);
    EXECUTE format('
        INSERT INTO %1$I.pares_id_bling_nuvemshop
            (id_produto_bling, codigo_item, store_id, id_produto_ns, id_variante, sku, id_pedido_bling, id_pedido_ns, nivel)
        SELECT id_produto_bling, codigo_item, store_id, id_produto_ns, id_variante, sku, id_pedido_bling, id_pedido_ns, nivel
        FROM %1$I.vw_pares_id_bling_nuvemshop
    ', p_schema_name);
    GET DIAGNOSTICS v_linhas = ROW_COUNT;
    RETURN v_linhas;
END;
$$;
REVOKE ALL ON FUNCTION atualizar_pares_id_bling_nuvemshop(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION atualizar_pares_id_bling_nuvemshop(TEXT) TO service_role;

-- Par confirmado de cada variante, por ID (nunca por SKU nem nome). Duas fontes, em ordem de força:
--   1) 'vinculo': o vínculo produto x loja do PRÓPRIO BLING ("ID na loja", barbers.produtos_lojas) — em qualquer loja do grupo Nuvemshop —
--      cujo `codigo` é o ID da variante (produto com várias variantes) ou o ID do produto (produto de variante única) e cujo produto do
--      Bling está ATIVO. Cobre o catálogo inteiro, inclusive o que nunca vendeu. Mais de um produto ativo apontando = ambíguo.
--   2) 'pedidos': o produto do Bling mais frequente nas vendas da variante (pares_id_bling_nuvemshop). Só usado quando não há vínculo.
-- fonte = 'vinculo+pedidos' quando as duas concordam. ambiguo = empate/mais de um candidato; produtos_distintos > 1 = a variante
-- apareceu em pedidos com mais de um produto. Sem p_variantes devolve todas.
DROP FUNCTION IF EXISTS obter_pares_confirmados_nuvemshop(TEXT, BIGINT[]);
CREATE OR REPLACE FUNCTION obter_pares_confirmados_nuvemshop(p_schema_name TEXT, p_variantes BIGINT[] DEFAULT NULL)
RETURNS TABLE(
    id_variante BIGINT, id_produto_bling BIGINT, codigo TEXT, nome TEXT, preco NUMERIC, ativo BOOLEAN,
    pedidos INTEGER, pedidos_unicos INTEGER, produtos_distintos INTEGER, ambiguo BOOLEAN, qtd_variantes_ns INTEGER, fonte TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_tenant_access(p_schema_name);
    RETURN QUERY EXECUTE format('
        WITH nsv AS (
            SELECT n.id_variante, n.id_produto, count(*) OVER (PARTITION BY n.id_produto) AS variantes_do_produto
            FROM %1$I.nuvemshop_produtos n
            WHERE ($1::BIGINT[] IS NULL OR n.id_variante = ANY($1))
        ),
        lojas_ns AS (SELECT id_loja FROM %1$I.canais_venda WHERE grupo = ''Nuvemshop''),
        vl AS (   -- fonte 1: vínculo do Bling apontando pra variante/produto, só produto ATIVO do Bling
            SELECT DISTINCT v.id_variante, l.id_produto AS id_produto_bling
            FROM nsv v
            JOIN %1$I.produtos_lojas l ON l.id_loja IN (SELECT id_loja FROM lojas_ns)
                 AND (l.codigo = v.id_variante::TEXT OR (v.variantes_do_produto = 1 AND l.codigo = v.id_produto::TEXT))
            JOIN %1$I.produtos pr ON pr.id_produto = l.id_produto AND pr.situacao = ''A''
        ),
        vl_agg AS (SELECT id_variante, count(*)::INTEGER AS qtd, min(id_produto_bling) AS id_produto_bling FROM vl GROUP BY id_variante),
        por_par AS (   -- fonte 2: pedidos
            SELECT v.id_variante, v.id_produto_bling,
                   count(DISTINCT v.id_pedido_bling)::INTEGER AS pedidos,
                   (count(*) FILTER (WHERE v.nivel = ''unico''))::INTEGER AS pedidos_unicos
            FROM %1$I.pares_id_bling_nuvemshop v
            WHERE ($1::BIGINT[] IS NULL OR v.id_variante = ANY($1))
            GROUP BY v.id_variante, v.id_produto_bling
        ),
        rk AS (
            SELECT pp.*,
                   row_number() OVER (PARTITION BY id_variante ORDER BY pedidos DESC, pedidos_unicos DESC, id_produto_bling) AS r,
                   count(*) OVER (PARTITION BY id_variante)::INTEGER AS produtos_distintos,
                   lead(pedidos) OVER (PARTITION BY id_variante ORDER BY pedidos DESC, pedidos_unicos DESC, id_produto_bling) AS pedidos_segundo
            FROM por_par pp
        ),
        pe AS (SELECT * FROM rk WHERE r = 1),
        escolha AS (   -- vínculo tem prioridade; sem ele, pedidos
            SELECT COALESCE(a.id_variante, e.id_variante) AS id_variante,
                   CASE WHEN a.id_variante IS NOT NULL THEN a.id_produto_bling ELSE e.id_produto_bling END AS id_produto_bling,
                   CASE WHEN a.id_variante IS NOT NULL AND e.id_variante IS NOT NULL AND a.id_produto_bling = e.id_produto_bling THEN ''vinculo+pedidos''
                        WHEN a.id_variante IS NOT NULL THEN ''vinculo'' ELSE ''pedidos'' END AS fonte,
                   CASE WHEN a.id_variante IS NOT NULL THEN a.qtd > 1
                        ELSE (e.pedidos_segundo IS NOT NULL AND e.pedidos_segundo = e.pedidos) END AS ambiguo,
                   COALESCE(e.produtos_distintos, 0) AS produtos_distintos
            FROM vl_agg a FULL JOIN pe e ON e.id_variante = a.id_variante
        ),
        skus AS MATERIALIZED (
            SELECT n.id_variante, public.normalizar_sku(n.sku) AS c FROM %1$I.nuvemshop_produtos n
            WHERE public.normalizar_sku(n.sku) IS NOT NULL
        ),
        sk_cnt AS MATERIALIZED (SELECT c, count(*)::INTEGER AS n FROM skus GROUP BY c),
        -- MATERIALIZED: sem isso o planejador embute normalizar_sku() na junção e a recalcula por linha (~3,5 s).
        topo AS MATERIALIZED (
            SELECT e.*, p.codigo AS p_codigo, p.nome AS p_nome, p.preco AS p_preco, p.situacao AS p_situacao,
                   public.normalizar_sku(p.codigo) AS cod_norm,
                   COALESCE(pp.pedidos, 0) AS pedidos, COALESCE(pp.pedidos_unicos, 0) AS pedidos_unicos
            FROM escolha e
            JOIN %1$I.produtos p ON p.id_produto = e.id_produto_bling
            LEFT JOIN por_par pp ON pp.id_variante = e.id_variante AND pp.id_produto_bling = e.id_produto_bling
        )
        SELECT t.id_variante, t.id_produto_bling, t.p_codigo::TEXT, t.p_nome::TEXT, t.p_preco::NUMERIC, (t.p_situacao = ''A''),
               t.pedidos, t.pedidos_unicos, t.produtos_distintos, t.ambiguo,
               (COALESCE(sc.n, 0) - CASE WHEN s2.id_variante IS NOT NULL THEN 1 ELSE 0 END)::INTEGER,
               t.fonte
        FROM topo t
        LEFT JOIN sk_cnt sc ON sc.c = t.cod_norm
        LEFT JOIN skus s2 ON s2.id_variante = t.id_variante AND s2.c = t.cod_norm
    ', p_schema_name) USING p_variantes;
END;
$$;

-- Divergências: variantes JÁ vinculadas por SKU cujo produto do Bling pelo SKU é diferente do produto que o par confirmado
-- aponta (vínculo do Bling e/ou pedidos, sem empate). Pra revisão: o SKU pode estar apontando pro produto errado.
DROP FUNCTION IF EXISTS obter_divergencias_sku_pedidos(TEXT);
CREATE OR REPLACE FUNCTION obter_divergencias_sku_pedidos(p_schema_name TEXT)
RETURNS TABLE(
    store_id BIGINT, id_produto_ns BIGINT, id_variante BIGINT, nome_ns TEXT, variacao_ns TEXT, sku_ns TEXT,
    publicado BOOLEAN, estoque_ns NUMERIC,
    sku_id_produto_bling BIGINT, sku_codigo TEXT, sku_nome TEXT,
    vendas_id_produto_bling BIGINT, vendas_codigo TEXT, vendas_nome TEXT, vendas_ativo BOOLEAN,
    pedidos INTEGER, produtos_distintos INTEGER, qtd_variantes_ns INTEGER, fonte TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_tenant_access(p_schema_name);
    RETURN QUERY EXECUTE format('
        SELECT t.store_id, t.id_produto_ns, t.id_variante, t.nome_ns, t.variacao_ns, t.sku_ns, t.publicado, t.estoque_ns,
               t.id_produto_bling, t.codigo_bling, t.nome_bling,
               c.id_produto_bling, c.codigo, c.nome, c.ativo, c.pedidos, c.produtos_distintos, c.qtd_variantes_ns, c.fonte
        FROM (%2$s) t
        JOIN public.obter_pares_confirmados_nuvemshop(%1$L) c ON c.id_variante = t.id_variante
        WHERE t.visao = ''nuvemshop'' AND t.status = ''vinculado''
          AND NOT c.ambiguo AND c.id_produto_bling <> t.id_produto_bling
        ORDER BY c.pedidos DESC, t.nome_ns
    ', p_schema_name, public.vinculo_sku_nuvemshop_sql(p_schema_name));
END;
$$;

REVOKE ALL ON FUNCTION obter_pares_confirmados_nuvemshop(TEXT, BIGINT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION obter_divergencias_sku_pedidos(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION obter_pares_confirmados_nuvemshop(TEXT, BIGINT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION obter_divergencias_sku_pedidos(TEXT) TO authenticated;
