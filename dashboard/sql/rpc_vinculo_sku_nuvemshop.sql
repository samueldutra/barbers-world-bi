-- Módulo "Vínculo de SKU": cruza o catálogo da Nuvemshop (barbers.nuvemshop_produtos, uma linha
-- por variante, carregado por etl-nuvemshop-produtos) com os produtos ATIVOS do Bling
-- (barbers.produtos.codigo = SKU) e classifica cada variante.
--
-- Comparação normalizada (maiúsculas, sem espaços nas pontas, espaços internos colapsados), porque a
-- Nuvemshop aceita SKU com espaço no fim ("MAGIC CLIP ") e o Bling não — a diferença é só de cadastro.
--
-- Status (lado Nuvemshop):
--   vinculado           SKU idêntico a exatamente 1 produto ativo do Bling
--   vinculado_ajustar   casa com 1 produto do Bling só depois de normalizar (espaço/maiúscula) — corrigir o SKU
--   sku_duplicado       o SKU aparece em mais de uma variante da Nuvemshop OU em mais de um produto do Bling
--   sem_correspondencia SKU preenchido, mas não existe produto ativo com esse código no Bling
--   sem_sku             variante sem SKU
-- Lado Bling:
--   so_bling            produto ativo do Bling sem nenhuma variante na Nuvemshop

CREATE OR REPLACE FUNCTION public.normalizar_sku(p_sku TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NULLIF(upper(regexp_replace(btrim(COALESCE(p_sku, '')), '\s+', ' ', 'g')), '')
$$;

-- SQL compartilhado (listagem e resumo) com todas as linhas classificadas. Interno: ninguém além do
-- dono chama; as RPCs abaixo são SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.vinculo_sku_nuvemshop_sql(p_schema TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT format($q$
        WITH ns AS (
            SELECT n.*, public.normalizar_sku(n.sku) AS sku_norm FROM %1$I.nuvemshop_produtos n
        ),
        bl AS (
            SELECT p.id_produto, p.codigo, p.nome, p.preco, p.formato, p.imagem_url,
                   public.normalizar_sku(p.codigo) AS cod_norm
            FROM %1$I.produtos p
            WHERE p.situacao = 'A'
        ),
        bl_agg AS (
            SELECT cod_norm, count(*) AS qtd, min(id_produto) AS id_produto
            FROM bl WHERE cod_norm IS NOT NULL GROUP BY cod_norm
        ),
        ns_agg AS (
            SELECT store_id, sku_norm, count(*) AS qtd
            FROM ns WHERE sku_norm IS NOT NULL GROUP BY store_id, sku_norm
        ),
        lado_ns AS (
            SELECT
                'nuvemshop'::TEXT AS visao,
                n.store_id, n.id_produto AS id_produto_ns, n.id_variante,
                n.nome::TEXT AS nome_ns, n.variacao::TEXT AS variacao_ns, n.sku::TEXT AS sku_ns,
                n.publicado, n.preco::NUMERIC AS preco_ns, n.preco_promocional::NUMERIC AS preco_promocional_ns,
                n.estoque::NUMERIC AS estoque_ns, n.url AS url_ns,
                COALESCE(n.imagem_url, b.imagem_url)::TEXT AS imagem_url,
                b.id_produto AS id_produto_bling, b.codigo::TEXT AS codigo_bling, b.nome::TEXT AS nome_bling,
                b.preco::NUMERIC AS preco_bling, b.formato::TEXT AS formato_bling,
                COALESCE(ba.qtd, 0)::INTEGER AS qtd_bling,
                CASE
                    WHEN n.sku_norm IS NULL THEN 'sem_sku'
                    WHEN na.qtd > 1 THEN 'sku_duplicado'
                    WHEN ba.qtd IS NULL THEN 'sem_correspondencia'
                    WHEN ba.qtd > 1 THEN 'sku_duplicado'
                    WHEN n.sku IS DISTINCT FROM b.codigo THEN 'vinculado_ajustar'
                    ELSE 'vinculado'
                END::TEXT AS status
            FROM ns n
            LEFT JOIN bl_agg ba ON ba.cod_norm = n.sku_norm
            LEFT JOIN bl b ON b.id_produto = ba.id_produto
            LEFT JOIN ns_agg na ON na.store_id = n.store_id AND na.sku_norm = n.sku_norm
        ),
        lado_bling AS (
            SELECT
                'bling'::TEXT, NULL::BIGINT, NULL::BIGINT, NULL::BIGINT,
                NULL::TEXT, NULL::TEXT, NULL::TEXT,
                NULL::BOOLEAN, NULL::NUMERIC, NULL::NUMERIC,
                NULL::NUMERIC, NULL::TEXT,
                b.imagem_url::TEXT,
                b.id_produto, b.codigo::TEXT, b.nome::TEXT,
                b.preco::NUMERIC, b.formato::TEXT,
                1::INTEGER,
                'so_bling'::TEXT
            FROM bl b
            WHERE NOT EXISTS (SELECT 1 FROM ns WHERE ns.sku_norm = b.cod_norm)
        )
        SELECT * FROM lado_ns UNION ALL SELECT * FROM lado_bling
    $q$, p_schema)
$$;

DROP FUNCTION IF EXISTS obter_vinculo_sku_nuvemshop(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION obter_vinculo_sku_nuvemshop(
    p_schema_name TEXT,
    p_status TEXT DEFAULT 'todos',          -- 'todos' (todas as variantes da Nuvemshop) | 'problemas' (todas menos 'vinculado')
                                            -- | um status específico (inclui 'so_bling')
    p_busca TEXT DEFAULT NULL,              -- nome ou SKU, de qualquer um dos lados
    p_apenas_publicados BOOLEAN DEFAULT TRUE, -- só variantes de produto publicado na Nuvemshop (não afeta 'so_bling')
    p_ordenar_por TEXT DEFAULT 'status',    -- 'status' | 'nome' | 'sku'
    p_ordenar_direcao TEXT DEFAULT 'asc',
    p_pagina INTEGER DEFAULT 1,
    p_tamanho_pagina INTEGER DEFAULT 50
)
RETURNS TABLE(
    visao TEXT,
    store_id BIGINT,
    id_produto_ns BIGINT,
    id_variante BIGINT,
    nome_ns TEXT,
    variacao_ns TEXT,
    sku_ns TEXT,
    publicado BOOLEAN,
    preco_ns NUMERIC,
    preco_promocional_ns NUMERIC,
    estoque_ns NUMERIC,
    url_ns TEXT,
    imagem_url TEXT,
    id_produto_bling BIGINT,
    codigo_bling TEXT,
    nome_bling TEXT,
    preco_bling NUMERIC,
    formato_bling TEXT,
    qtd_bling INTEGER,
    status TEXT,
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
    v_offset INTEGER;
BEGIN
    -- Ordem padrão = do mais grave ao menos grave (sem SKU, duplicado, sem correspondência, ajustar...).
    v_ordem := CASE p_ordenar_por
        WHEN 'nome' THEN 'COALESCE(nome_ns, nome_bling)'
        WHEN 'sku' THEN 'COALESCE(sku_ns, codigo_bling)'
        ELSE 'CASE status WHEN ''sem_sku'' THEN 1 WHEN ''sku_duplicado'' THEN 2 WHEN ''sem_correspondencia'' THEN 3
                          WHEN ''vinculado_ajustar'' THEN 4 WHEN ''vinculado'' THEN 5 ELSE 6 END'
    END;
    v_direcao := CASE lower(p_ordenar_direcao) WHEN 'desc' THEN 'DESC' ELSE 'ASC' END;
    v_busca := CASE WHEN p_busca IS NULL OR btrim(p_busca) = '' THEN NULL ELSE '%' || btrim(p_busca) || '%' END;
    v_offset := (GREATEST(p_pagina, 1) - 1) * GREATEST(p_tamanho_pagina, 1);

    RETURN QUERY EXECUTE format($q$
        SELECT t.visao, t.store_id, t.id_produto_ns, t.id_variante, t.nome_ns, t.variacao_ns, t.sku_ns,
               t.publicado, t.preco_ns, t.preco_promocional_ns, t.estoque_ns, t.url_ns, t.imagem_url,
               t.id_produto_bling, t.codigo_bling, t.nome_bling, t.preco_bling, t.formato_bling, t.qtd_bling,
               t.status, count(*) OVER()::BIGINT AS total_registros
        FROM (%s) t
        WHERE CASE %L
                WHEN 'todos' THEN t.visao = 'nuvemshop'
                WHEN 'problemas' THEN t.visao = 'nuvemshop' AND t.status <> 'vinculado'
                ELSE t.status = %L
              END
          AND (NOT %L OR t.visao = 'bling' OR t.publicado IS TRUE)
          AND (%L::TEXT IS NULL OR t.nome_ns ILIKE %L OR t.sku_ns ILIKE %L
               OR t.nome_bling ILIKE %L OR t.codigo_bling ILIKE %L)
        ORDER BY %s %s NULLS LAST, COALESCE(t.nome_ns, t.nome_bling), t.id_variante NULLS LAST, t.id_produto_bling
        LIMIT %L OFFSET %L
    $q$, public.vinculo_sku_nuvemshop_sql(p_schema_name), p_status, p_status, p_apenas_publicados,
         v_busca, v_busca, v_busca, v_busca, v_busca,
         v_ordem, v_direcao, p_tamanho_pagina, v_offset);
END;
$$;

-- Contagem por status pros cartões do topo da tela.
CREATE OR REPLACE FUNCTION obter_resumo_vinculo_sku_nuvemshop(
    p_schema_name TEXT,
    p_apenas_publicados BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(status TEXT, quantidade BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY EXECUTE format($q$
        SELECT t.status, count(*)::BIGINT
        FROM (%s) t
        WHERE (NOT %L OR t.visao = 'bling' OR t.publicado IS TRUE)
        GROUP BY t.status
    $q$, public.vinculo_sku_nuvemshop_sql(p_schema_name), p_apenas_publicados);
END;
$$;

REVOKE ALL ON FUNCTION public.vinculo_sku_nuvemshop_sql(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION obter_vinculo_sku_nuvemshop(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION obter_resumo_vinculo_sku_nuvemshop(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION obter_vinculo_sku_nuvemshop(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION obter_resumo_vinculo_sku_nuvemshop(TEXT, BOOLEAN) TO authenticated;
