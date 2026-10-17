-- Módulo "Produtos > Gestão de Produtos": catálogo dos produtos ATIVOS do Bling (barbers.produtos, situacao = 'A')
-- com saldo de estoque (barbers.estoque_saldos_bling) e a situação na Nuvemshop (barbers.nuvemshop_produtos),
-- cruzada por SKU idêntico normalizado (mesma regra do Vínculo de SKU: normalizar_sku). Só leitura.
--
--   p_filtro: 'todos' | 'sem_codigo' | 'sem_marca' | 'sem_categoria' | 'sem_estoque' (saldo virtual <= 0)
--             | 'sem_nuvemshop' (nenhuma variante com o SKU) | 'nuvemshop_despublicado' (existe, mas nenhuma variante publicada)
--             | 'preco_alterado' (preço mudou nos últimos 7 dias, ver data_alteracao_preco)
--             | 'sem_custo' (sem preço de custo no Bling, 0 ou vazio)
--   Margem bruta = (preço de venda no Bling − custo no Bling) / preço de venda; só existe com custo > 0 e preço > 0.
--   O custo é fornecedor.precoCusto do cadastro (produtos.preco_custo, gravado por sync-produtos-bling.py).
--   p_busca: nome ou código (SKU)
--   p_marca / p_categoria: texto exato (categoria_descricao)
--   p_ordenar_por: 'nome' | 'preco' | 'estoque' | 'marca' | 'custo' | 'margem'

DROP FUNCTION IF EXISTS obter_catalogo_produtos(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION obter_catalogo_produtos(
    p_schema_name TEXT,
    p_filtro TEXT DEFAULT 'todos',
    p_busca TEXT DEFAULT NULL,
    p_marca TEXT DEFAULT NULL,
    p_categoria TEXT DEFAULT NULL,
    p_ordenar_por TEXT DEFAULT 'nome',
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
    imagem_url TEXT,
    preco NUMERIC,
    preco_custo NUMERIC,
    margem_valor NUMERIC,
    margem_pct NUMERIC,
    preco_anterior NUMERIC,
    data_alteracao_preco TIMESTAMPTZ,
    saldo_virtual NUMERIC,
    saldo_fisico NUMERIC,
    ns_variantes INTEGER,
    ns_publicado BOOLEAN,
    ns_estoque NUMERIC,
    ns_preco NUMERIC,
    ns_url TEXT,
    total_registros BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ordem TEXT;
    v_direcao TEXT;
    v_busca TEXT;
    v_limite INTEGER;
    v_offset INTEGER;
BEGIN
    v_ordem := CASE p_ordenar_por
        WHEN 'preco' THEN 'b.preco'
        WHEN 'estoque' THEN 'b.saldo_virtual'
        WHEN 'marca' THEN 'b.marca'
        WHEN 'custo' THEN 'b.preco_custo'
        WHEN 'margem' THEN 'b.margem_pct'
        ELSE 'b.nome'
    END;
    v_direcao := CASE lower(p_ordenar_direcao) WHEN 'desc' THEN 'DESC' ELSE 'ASC' END;
    v_busca := CASE WHEN p_busca IS NULL OR btrim(p_busca) = '' THEN NULL ELSE '%' || btrim(p_busca) || '%' END;
    v_limite := GREATEST(LEAST(p_tamanho_pagina, 20000), 1);
    v_offset := (GREATEST(p_pagina, 1) - 1) * v_limite;

    RETURN QUERY EXECUTE format($q$
        WITH ns AS (
            SELECT public.normalizar_sku(n.sku) AS sku_norm,
                   count(*)::INTEGER AS variantes,
                   bool_or(COALESCE(n.publicado, FALSE)) AS publicado,
                   sum(n.estoque) AS estoque,
                   min(n.preco) AS preco,
                   max(n.url)::TEXT AS url
            FROM %1$I.nuvemshop_produtos n
            WHERE public.normalizar_sku(n.sku) IS NOT NULL
            GROUP BY 1
        ),
        base AS (
            SELECT p.id_produto, p.codigo::TEXT AS codigo, p.nome::TEXT AS nome,
                   NULLIF(btrim(p.marca), '')::TEXT AS marca,
                   NULLIF(btrim(p.categoria_descricao), '')::TEXT AS categoria_descricao,
                   p.imagem_url::TEXT AS imagem_url,
                   p.preco::NUMERIC AS preco,
                   CASE WHEN p.preco_custo > 0 THEN p.preco_custo::NUMERIC END AS preco_custo,
                   CASE WHEN p.preco_custo > 0 AND p.preco > 0 THEN (p.preco - p.preco_custo)::NUMERIC END AS margem_valor,
                   CASE WHEN p.preco_custo > 0 AND p.preco > 0 THEN round((p.preco - p.preco_custo) / p.preco * 100, 2)::NUMERIC END AS margem_pct,
                   p.preco_anterior::NUMERIC AS preco_anterior, p.data_alteracao_preco,
                   e.saldo_virtual::NUMERIC AS saldo_virtual, e.saldo_fisico::NUMERIC AS saldo_fisico,
                   COALESCE(ns.variantes, 0) AS ns_variantes, ns.publicado AS ns_publicado,
                   ns.estoque::NUMERIC AS ns_estoque, ns.preco::NUMERIC AS ns_preco, ns.url AS ns_url
            FROM %1$I.produtos p
            LEFT JOIN %1$I.estoque_saldos_bling e ON e.id_produto = p.id_produto
            LEFT JOIN ns ON ns.sku_norm = public.normalizar_sku(p.codigo)
            WHERE p.situacao = 'A'
        ),
        filtrada AS (
            SELECT b.*,
                   row_number() OVER (ORDER BY %2$s %3$s NULLS LAST, b.nome, b.id_produto) AS rn,
                   count(*) OVER()::BIGINT AS tot
            FROM base b
            WHERE CASE %4$L
                    WHEN 'sem_codigo' THEN public.normalizar_sku(b.codigo) IS NULL
                    WHEN 'sem_marca' THEN b.marca IS NULL
                    WHEN 'sem_categoria' THEN b.categoria_descricao IS NULL
                    WHEN 'sem_estoque' THEN COALESCE(b.saldo_virtual, 0) <= 0
                    WHEN 'sem_nuvemshop' THEN b.ns_variantes = 0
                    WHEN 'nuvemshop_despublicado' THEN b.ns_variantes > 0 AND b.ns_publicado IS NOT TRUE
                    WHEN 'sem_custo' THEN COALESCE(b.preco_custo, 0) <= 0
                    WHEN 'preco_alterado' THEN b.data_alteracao_preco >= now() - interval '7 days'
                    ELSE TRUE
                  END
              AND (%5$L::TEXT IS NULL OR b.nome ILIKE %5$L OR b.codigo ILIKE %5$L)
              AND (%6$L::TEXT IS NULL OR b.marca = %6$L)
              AND (%7$L::TEXT IS NULL OR b.categoria_descricao = %7$L)
        )
        SELECT f.id_produto, f.codigo, f.nome, f.marca, f.categoria_descricao, f.imagem_url,
               f.preco, f.preco_custo, f.margem_valor, f.margem_pct, f.preco_anterior, f.data_alteracao_preco, f.saldo_virtual, f.saldo_fisico,
               f.ns_variantes, f.ns_publicado, f.ns_estoque, f.ns_preco, f.ns_url, f.tot
        FROM filtrada f
        WHERE f.rn > %8$L AND f.rn <= %9$L
        ORDER BY f.rn
    $q$, p_schema_name, v_ordem, v_direcao, p_filtro, v_busca,
         NULLIF(btrim(p_marca), ''), NULLIF(btrim(p_categoria), ''), v_offset, v_offset + v_limite);
END;
$$;

-- Cartões do topo: quantos produtos ativos em cada situação.
DROP FUNCTION IF EXISTS obter_resumo_catalogo_produtos(TEXT);
CREATE OR REPLACE FUNCTION obter_resumo_catalogo_produtos(p_schema_name TEXT)
RETURNS TABLE(
    total BIGINT, sem_codigo BIGINT, sem_marca BIGINT, sem_categoria BIGINT, sem_estoque BIGINT,
    sem_nuvemshop BIGINT, nuvemshop_despublicado BIGINT, preco_alterado BIGINT, sem_custo BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY EXECUTE format($q$
        WITH ns AS (
            SELECT public.normalizar_sku(n.sku) AS sku_norm, bool_or(COALESCE(n.publicado, FALSE)) AS publicado
            FROM %1$I.nuvemshop_produtos n
            WHERE public.normalizar_sku(n.sku) IS NOT NULL
            GROUP BY 1
        )
        SELECT count(*)::BIGINT,
               count(*) FILTER (WHERE public.normalizar_sku(p.codigo) IS NULL)::BIGINT,
               count(*) FILTER (WHERE NULLIF(btrim(p.marca), '') IS NULL)::BIGINT,
               count(*) FILTER (WHERE NULLIF(btrim(p.categoria_descricao), '') IS NULL)::BIGINT,
               count(*) FILTER (WHERE COALESCE(e.saldo_virtual, 0) <= 0)::BIGINT,
               count(*) FILTER (WHERE ns.sku_norm IS NULL)::BIGINT,
               count(*) FILTER (WHERE ns.sku_norm IS NOT NULL AND ns.publicado IS NOT TRUE)::BIGINT,
               count(*) FILTER (WHERE p.data_alteracao_preco >= now() - interval '7 days')::BIGINT,
               count(*) FILTER (WHERE COALESCE(p.preco_custo, 0) <= 0)::BIGINT
        FROM %1$I.produtos p
        LEFT JOIN %1$I.estoque_saldos_bling e ON e.id_produto = p.id_produto
        LEFT JOIN ns ON ns.sku_norm = public.normalizar_sku(p.codigo)
        WHERE p.situacao = 'A'
    $q$, p_schema_name);
END;
$$;

REVOKE ALL ON FUNCTION obter_catalogo_produtos(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION obter_resumo_catalogo_produtos(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION obter_catalogo_produtos(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION obter_resumo_catalogo_produtos(TEXT) TO authenticated;
