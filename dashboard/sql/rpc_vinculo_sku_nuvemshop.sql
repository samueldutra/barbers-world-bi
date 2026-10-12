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
--
-- Sugestão (só pra 'sem_correspondencia' e 'sem_sku'): o produto "só no Bling" de nome mais parecido
-- (pg_trgm sobre o nome normalizado, comparando com o nome e com nome + variação da Nuvemshop). Só aparece
-- com pontuação >= 0,40; a tela rotula: >= 1,00 idêntico, >= 0,80 provável, >= 0,60 possível, resto fraca.
-- É sugestão a confirmar — o vínculo continua sendo corrigido no SKU (Nuvemshop ou Bling).

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.normalizar_nome(p_nome TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NULLIF(btrim(regexp_replace(
        translate(lower(COALESCE(p_nome, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
        '[^a-z0-9]+', ' ', 'g')), '')
$$;

-- Índice GiST de trigramas: a sugestão é uma busca por vizinho mais próximo (operador <->) nele; sem o índice
-- a similaridade contra todos os produtos, linha a linha, leva ~50 s pra exportar 500 linhas (com ele, ~4 s).
-- Criar um por schema/tenant (aqui "barbers").
CREATE INDEX IF NOT EXISTS idx_produtos_nome_trgm
    ON barbers.produtos USING gist (public.normalizar_nome(nome) extensions.gist_trgm_ops);

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
DROP FUNCTION IF EXISTS obter_vinculo_sku_nuvemshop(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION obter_vinculo_sku_nuvemshop(
    p_schema_name TEXT,
    p_status TEXT DEFAULT 'todos',          -- 'todos' (todas as variantes da Nuvemshop) | 'problemas' (todas menos 'vinculado')
                                            -- | um status específico (inclui 'so_bling')
    p_busca TEXT DEFAULT NULL,              -- nome ou SKU, de qualquer um dos lados
    p_apenas_publicados BOOLEAN DEFAULT TRUE, -- só variantes de produto publicado na Nuvemshop (não afeta 'so_bling')
    p_ordenar_por TEXT DEFAULT 'status',    -- 'status' | 'nome' | 'sku'
    p_ordenar_direcao TEXT DEFAULT 'asc',
    p_pagina INTEGER DEFAULT 1,
    p_tamanho_pagina INTEGER DEFAULT 50,
    p_apenas_com_estoque BOOLEAN DEFAULT FALSE -- só variantes com estoque > 0 na Nuvemshop (NULL = não controlado fica fora; não afeta 'so_bling')
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
    sugestao_id_produto_bling BIGINT,       -- produto "só no Bling" mais parecido (NULL = sem sugestão)
    sugestao_codigo TEXT,
    sugestao_nome TEXT,
    sugestao_preco NUMERIC,
    sugestao_score NUMERIC,                 -- 0 a 1 (1 = nome idêntico depois de normalizar)
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
    v_limite INTEGER;
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
    v_limite := GREATEST(p_tamanho_pagina, 1);
    v_offset := (GREATEST(p_pagina, 1) - 1) * v_limite;

    -- A sugestão é o produto ativo do Bling de nome mais parecido que ainda não está vinculado a nenhuma
    -- variante da Nuvemshop, achado por vizinho mais próximo no índice GiST de trigramas
    -- (idx_produtos_nome_trgm) — só pras linhas da página.
    RETURN QUERY EXECUTE format($q$
        WITH base AS (%s),
        filtrada AS (
            SELECT t.*,
                   row_number() OVER (ORDER BY %s %s NULLS LAST, COALESCE(t.nome_ns, t.nome_bling),
                                               t.id_variante NULLS LAST, t.id_produto_bling) AS rn,
                   count(*) OVER()::BIGINT AS tot
            FROM base t
            WHERE CASE %L
                    WHEN 'todos' THEN t.visao = 'nuvemshop'
                    WHEN 'problemas' THEN t.visao = 'nuvemshop' AND t.status <> 'vinculado'
                    ELSE t.status = %L
                  END
              AND (NOT %L OR t.visao = 'bling' OR t.publicado IS TRUE)
              AND (NOT %L OR t.visao = 'bling' OR t.estoque_ns > 0)
              AND (%L::TEXT IS NULL OR t.nome_ns ILIKE %L OR t.sku_ns ILIKE %L
                   OR t.nome_bling ILIKE %L OR t.codigo_bling ILIKE %L)
        ),
        pagina AS (SELECT * FROM filtrada WHERE rn > %L AND rn <= %L),
        skus_ns AS MATERIALIZED (
            SELECT DISTINCT public.normalizar_sku(sku) AS sku_norm FROM %I.nuvemshop_produtos
            WHERE public.normalizar_sku(sku) IS NOT NULL
        )
        SELECT p.visao, p.store_id, p.id_produto_ns, p.id_variante, p.nome_ns, p.variacao_ns, p.sku_ns,
               p.publicado, p.preco_ns, p.preco_promocional_ns, p.estoque_ns, p.url_ns, p.imagem_url,
               p.id_produto_bling, p.codigo_bling, p.nome_bling, p.preco_bling, p.formato_bling, p.qtd_bling,
               p.status,
               s.id_produto, s.codigo::TEXT, s.nome::TEXT, s.preco::NUMERIC, s.score,
               p.tot
        FROM pagina p
        LEFT JOIN LATERAL (
            SELECT c.id_produto, c.codigo, c.nome, c.preco,
                   round(extensions.similarity(public.normalizar_nome(c.nome), k.chave)::NUMERIC, 3) AS score
            FROM (SELECT public.normalizar_nome(COALESCE(p.nome_ns, '') || ' ' || COALESCE(p.variacao_ns, '')) AS chave) k
            CROSS JOIN LATERAL (
                SELECT pr.id_produto, pr.codigo, pr.nome, pr.preco
                FROM %I.produtos pr
                WHERE pr.situacao = 'A'
                  AND p.status IN ('sem_correspondencia', 'sem_sku')
                  AND NOT EXISTS (SELECT 1 FROM skus_ns sn WHERE sn.sku_norm = public.normalizar_sku(pr.codigo))
                ORDER BY public.normalizar_nome(pr.nome) OPERATOR(extensions.<->) k.chave
                LIMIT 1
            ) c
        ) s ON s.score >= 0.4
        ORDER BY p.rn
    $q$, public.vinculo_sku_nuvemshop_sql(p_schema_name),
         v_ordem, v_direcao, p_status, p_status, p_apenas_publicados, p_apenas_com_estoque,
         v_busca, v_busca, v_busca, v_busca, v_busca,
         v_offset, v_offset + v_limite, p_schema_name, p_schema_name);
END;
$$;

-- Contagem por status pros cartões do topo da tela.
DROP FUNCTION IF EXISTS obter_resumo_vinculo_sku_nuvemshop(TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION obter_resumo_vinculo_sku_nuvemshop(
    p_schema_name TEXT,
    p_apenas_publicados BOOLEAN DEFAULT TRUE,
    p_apenas_com_estoque BOOLEAN DEFAULT FALSE
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
          AND (NOT %L OR t.visao = 'bling' OR t.estoque_ns > 0)
        GROUP BY t.status
    $q$, public.vinculo_sku_nuvemshop_sql(p_schema_name), p_apenas_publicados, p_apenas_com_estoque);
END;
$$;

REVOKE ALL ON FUNCTION public.vinculo_sku_nuvemshop_sql(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION obter_vinculo_sku_nuvemshop(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION obter_resumo_vinculo_sku_nuvemshop(TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION obter_vinculo_sku_nuvemshop(TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION obter_resumo_vinculo_sku_nuvemshop(TEXT, BOOLEAN, BOOLEAN) TO authenticated;
