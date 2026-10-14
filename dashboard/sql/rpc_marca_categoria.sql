-- Módulo "Conferência de Marca e Categoria" (Nuvemshop): lista os PRODUTOS (não as variantes) com a marca e as
-- categorias atribuídas, com filtros "sem marca" / "sem categoria", a lista de marcas e de categorias disponíveis e
-- as funções de escrita usadas pela API (criar marca/categoria, espelhar a alteração feita na Nuvemshop, auditoria).
--
-- Dados: barbers.nuvemshop_produtos (marca, categorias_ids), barbers.nuvemshop_categorias, barbers.nuvemshop_marcas
-- (ver etl-nuvemshop-produtos/sql/marca_categoria.sql). Na Nuvemshop a marca é um texto livre do produto; as categorias
-- são cadastros hierárquicos. As marcas são comparadas sem diferença de maiúscula/espaço (normalizar_sku serve:
-- upper + btrim + espaços internos colapsados).

-- Definição da CTE `cat` (usada depois de WITH): caminho completo de cada categoria ("MÁQUINAS PROFISSIONAIS › MARCAS › WAHL"),
-- com proteção contra ciclo e contra pai inexistente.
CREATE OR REPLACE FUNCTION public.categorias_com_caminho_sql(p_schema TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT format($q$
        RECURSIVE cat AS (
            SELECT c.store_id, c.id_categoria, c.nome::TEXT AS nome, c.id_pai, c.nome::TEXT AS caminho, 1 AS nivel
            FROM %1$I.nuvemshop_categorias c
            WHERE c.id_pai IS NULL
               OR NOT EXISTS (SELECT 1 FROM %1$I.nuvemshop_categorias x WHERE x.store_id = c.store_id AND x.id_categoria = c.id_pai)
            UNION ALL
            SELECT c.store_id, c.id_categoria, c.nome::TEXT, c.id_pai, p.caminho || ' › ' || c.nome, p.nivel + 1
            FROM %1$I.nuvemshop_categorias c
            JOIN cat p ON p.store_id = c.store_id AND p.id_categoria = c.id_pai
            WHERE p.nivel < 8
        )
    $q$, p_schema)
$$;

-- Lista de produtos (um por produto da Nuvemshop) com marca e categorias.
--   p_filtro: 'todos' | 'sem_marca' | 'sem_categoria' | 'sem_marca_ou_categoria' | 'completos' (tem marca e categoria)
--   p_busca: nome do produto ou SKU de qualquer variante
--   p_marca: marca exata (sem diferença de maiúscula/espaço); vazio = qualquer
--   p_categoria_id: produtos dessa categoria ou de qualquer subcategoria dela; NULL = qualquer
DROP FUNCTION IF EXISTS obter_produtos_marca_categoria(TEXT, TEXT, TEXT, TEXT, BIGINT, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION obter_produtos_marca_categoria(
    p_schema_name TEXT,
    p_filtro TEXT DEFAULT 'todos',
    p_busca TEXT DEFAULT NULL,
    p_marca TEXT DEFAULT NULL,
    p_categoria_id BIGINT DEFAULT NULL,
    p_apenas_publicados BOOLEAN DEFAULT TRUE,
    p_ordenar_por TEXT DEFAULT 'nome',          -- 'nome' | 'marca'
    p_ordenar_direcao TEXT DEFAULT 'asc',
    p_pagina INTEGER DEFAULT 1,
    p_tamanho_pagina INTEGER DEFAULT 50
)
RETURNS TABLE(
    store_id BIGINT,
    id_produto_ns BIGINT,
    nome TEXT,
    publicado BOOLEAN,
    qtd_variantes INTEGER,
    sku_exemplo TEXT,
    imagem_url TEXT,
    url TEXT,
    marca TEXT,
    categorias JSONB,                           -- [{id, nome, caminho}]
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
    v_marca TEXT;
    v_limite INTEGER;
    v_offset INTEGER;
BEGIN
    v_ordem := CASE p_ordenar_por WHEN 'marca' THEN 'p.marca' ELSE 'p.nome' END;
    v_direcao := CASE lower(p_ordenar_direcao) WHEN 'desc' THEN 'DESC' ELSE 'ASC' END;
    v_busca := CASE WHEN p_busca IS NULL OR btrim(p_busca) = '' THEN NULL ELSE '%' || btrim(p_busca) || '%' END;
    v_marca := public.normalizar_sku(p_marca);
    v_limite := GREATEST(p_tamanho_pagina, 1);
    v_offset := (GREATEST(p_pagina, 1) - 1) * v_limite;

    RETURN QUERY EXECUTE format($q$
        WITH %1$s,
        produto AS (
            SELECT n.store_id, n.id_produto,
                   max(n.nome)::TEXT AS nome,
                   bool_or(n.publicado) AS publicado,
                   count(*)::INTEGER AS qtd_variantes,
                   (min(n.sku) FILTER (WHERE n.sku IS NOT NULL))::TEXT AS sku_exemplo,
                   string_agg(n.sku, ' ') AS skus,
                   max(n.imagem_url)::TEXT AS imagem_url,
                   max(n.url)::TEXT AS url,
                   max(NULLIF(btrim(n.marca), ''))::TEXT AS marca,
                   COALESCE(max(n.categorias_ids), ARRAY[]::BIGINT[]) AS categorias_ids
            FROM %2$I.nuvemshop_produtos n
            GROUP BY n.store_id, n.id_produto
        ),
        alvo_cat AS (
            -- a categoria escolhida + todas as subcategorias (qualquer nível)
            SELECT c.store_id, c.id_categoria FROM cat c WHERE c.id_categoria = %3$L
            UNION
            SELECT c.store_id, c.id_categoria FROM cat c
            WHERE %3$L::BIGINT IS NOT NULL AND c.caminho LIKE (SELECT x.caminho FROM cat x WHERE x.id_categoria = %3$L LIMIT 1) || ' › %%'
        ),
        filtrada AS (
            SELECT p.*,
                   row_number() OVER (ORDER BY %4$s %5$s NULLS LAST, p.nome, p.id_produto) AS rn,
                   count(*) OVER()::BIGINT AS tot
            FROM produto p
            WHERE CASE %6$L
                    WHEN 'sem_marca' THEN p.marca IS NULL
                    WHEN 'sem_categoria' THEN cardinality(p.categorias_ids) = 0
                    WHEN 'sem_marca_ou_categoria' THEN p.marca IS NULL OR cardinality(p.categorias_ids) = 0
                    WHEN 'completos' THEN p.marca IS NOT NULL AND cardinality(p.categorias_ids) > 0
                    ELSE TRUE
                  END
              AND (NOT %7$L OR p.publicado IS TRUE)
              AND (%8$L::TEXT IS NULL OR p.nome ILIKE %8$L OR p.skus ILIKE %8$L)
              AND (%9$L::TEXT IS NULL OR public.normalizar_sku(p.marca) = %9$L)
              AND (%3$L::BIGINT IS NULL OR EXISTS (
                      SELECT 1 FROM alvo_cat a WHERE a.store_id = p.store_id AND a.id_categoria = ANY(p.categorias_ids)))
        ),
        pagina AS (SELECT * FROM filtrada WHERE rn > %10$L AND rn <= %11$L)
        SELECT p.store_id, p.id_produto, p.nome, p.publicado, p.qtd_variantes, p.sku_exemplo, p.imagem_url, p.url, p.marca,
               COALESCE((
                   SELECT jsonb_agg(jsonb_build_object('id', c.id_categoria, 'nome', c.nome, 'caminho', c.caminho) ORDER BY c.caminho)
                   FROM cat c WHERE c.store_id = p.store_id AND c.id_categoria = ANY(p.categorias_ids)
               ), '[]'::JSONB) AS categorias,
               p.tot
        FROM pagina p
        ORDER BY p.rn
    $q$, public.categorias_com_caminho_sql(p_schema_name), p_schema_name,
         p_categoria_id, v_ordem, v_direcao, p_filtro, p_apenas_publicados, v_busca, v_marca, v_offset, v_offset + v_limite);
END;
$$;

-- Cartões do topo: quantos produtos em cada situação.
DROP FUNCTION IF EXISTS obter_resumo_marca_categoria(TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION obter_resumo_marca_categoria(
    p_schema_name TEXT,
    p_apenas_publicados BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(total BIGINT, sem_marca BIGINT, sem_categoria BIGINT, sem_ambos BIGINT, completos BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY EXECUTE format($q$
        WITH produto AS (
            SELECT n.store_id, n.id_produto, bool_or(n.publicado) AS publicado,
                   max(NULLIF(btrim(n.marca), '')) AS marca,
                   COALESCE(max(n.categorias_ids), ARRAY[]::BIGINT[]) AS cats
            FROM %1$I.nuvemshop_produtos n GROUP BY n.store_id, n.id_produto
        )
        SELECT count(*)::BIGINT,
               count(*) FILTER (WHERE marca IS NULL)::BIGINT,
               count(*) FILTER (WHERE cardinality(cats) = 0)::BIGINT,
               count(*) FILTER (WHERE marca IS NULL AND cardinality(cats) = 0)::BIGINT,
               count(*) FILTER (WHERE marca IS NOT NULL AND cardinality(cats) > 0)::BIGINT
        FROM produto WHERE (NOT %2$L OR publicado IS TRUE)
    $q$, p_schema_name, p_apenas_publicados);
END;
$$;

-- Categorias da loja, com caminho, nível e quantos produtos têm cada uma (direto).
DROP FUNCTION IF EXISTS obter_categorias_nuvemshop(TEXT);
CREATE OR REPLACE FUNCTION obter_categorias_nuvemshop(p_schema_name TEXT)
RETURNS TABLE(store_id BIGINT, id_categoria BIGINT, nome TEXT, id_pai BIGINT, caminho TEXT, nivel INTEGER, qtd_produtos BIGINT, qtd_subcategorias BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY EXECUTE format($q$
        WITH %1$s,
        uso AS (
            SELECT p.store_id, u.cid AS id_categoria, count(DISTINCT p.id_produto) AS qtd
            FROM %2$I.nuvemshop_produtos p, LATERAL unnest(COALESCE(p.categorias_ids, ARRAY[]::BIGINT[])) AS u(cid)
            GROUP BY p.store_id, u.cid
        )
        SELECT c.store_id, c.id_categoria, c.nome, c.id_pai, c.caminho, c.nivel::INTEGER,
               COALESCE(u.qtd, 0)::BIGINT,
               (SELECT count(*) FROM cat f WHERE f.store_id = c.store_id AND f.id_pai = c.id_categoria)::BIGINT
        FROM cat c LEFT JOIN uso u ON u.store_id = c.store_id AND u.id_categoria = c.id_categoria
        ORDER BY c.caminho
    $q$, public.categorias_com_caminho_sql(p_schema_name), p_schema_name);
END;
$$;

-- Marcas disponíveis: as usadas nos produtos (cada grafia exata) + as criadas pelo BI e ainda sem produto.
-- `grafias_na_chave` > 1 = a mesma marca aparece escrita de mais de um jeito (ex.: "Wahl" e "WAHL", ou com espaço no fim).
DROP FUNCTION IF EXISTS obter_marcas_nuvemshop(TEXT);
CREATE OR REPLACE FUNCTION obter_marcas_nuvemshop(p_schema_name TEXT)
RETURNS TABLE(nome TEXT, qtd_produtos BIGINT, grafias_na_chave INTEGER, criada_no_bi BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY EXECUTE format($q$
        WITH usadas AS (
            SELECT n.marca::TEXT AS nome, count(DISTINCT n.id_produto) AS qtd
            FROM %1$I.nuvemshop_produtos n WHERE NULLIF(btrim(n.marca), '') IS NOT NULL GROUP BY n.marca
        ),
        todas AS (
            SELECT u.nome, u.qtd FROM usadas u
            UNION ALL
            SELECT m.nome::TEXT, 0 FROM %1$I.nuvemshop_marcas m
            WHERE NOT EXISTS (SELECT 1 FROM usadas u WHERE public.normalizar_sku(u.nome) = public.normalizar_sku(m.nome))
        )
        SELECT t.nome, t.qtd::BIGINT,
               (count(*) OVER (PARTITION BY public.normalizar_sku(t.nome)))::INTEGER,
               EXISTS (SELECT 1 FROM %1$I.nuvemshop_marcas m WHERE public.normalizar_sku(m.nome) = public.normalizar_sku(t.nome))
        FROM todas t
        ORDER BY public.normalizar_sku(t.nome), t.qtd DESC
    $q$, p_schema_name);
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Escrita (só service_role: chamadas pelas rotas de API depois de conferir o usuário e o módulo)
-- ---------------------------------------------------------------------------------------------------------------

-- Cria uma marca no BI (a Nuvemshop só "conhece" a marca quando um produto a recebe). Devolve 'criada' ou 'ja_existe'.
CREATE OR REPLACE FUNCTION registrar_marca_nuvemshop(p_schema_name TEXT, p_store_id BIGINT, p_nome TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_nome TEXT := btrim(regexp_replace(COALESCE(p_nome, ''), '\s+', ' ', 'g'));
    v_existe BOOLEAN;
BEGIN
    IF v_nome = '' THEN RAISE EXCEPTION 'O nome da marca é obrigatório'; END IF;
    EXECUTE format('
        SELECT EXISTS (SELECT 1 FROM %1$I.nuvemshop_produtos WHERE public.normalizar_sku(marca) = public.normalizar_sku($1))
            OR EXISTS (SELECT 1 FROM %1$I.nuvemshop_marcas WHERE store_id = $2 AND public.normalizar_sku(nome) = public.normalizar_sku($1))
    ', p_schema_name) INTO v_existe USING v_nome, p_store_id;
    IF v_existe THEN RETURN 'ja_existe'; END IF;
    EXECUTE format('INSERT INTO %I.nuvemshop_marcas (store_id, nome) VALUES ($1, $2)', p_schema_name) USING p_store_id, v_nome;
    RETURN 'criada';
END;
$$;

-- Espelha no banco uma categoria recém-criada na Nuvemshop (aparece na lista sem esperar o próximo ETL).
CREATE OR REPLACE FUNCTION registrar_categoria_nuvemshop(
    p_schema_name TEXT, p_store_id BIGINT, p_id_categoria BIGINT, p_nome TEXT, p_id_pai BIGINT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    EXECUTE format('
        INSERT INTO %I.nuvemshop_categorias (store_id, id_categoria, nome, id_pai, data_sincronizacao)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (store_id, id_categoria) DO UPDATE SET nome = EXCLUDED.nome, id_pai = EXCLUDED.id_pai, data_sincronizacao = now()
    ', p_schema_name) USING p_store_id, p_id_categoria, left(p_nome, 200), p_id_pai;
END;
$$;

-- Dos ids informados, devolve os que NÃO existem no cadastro de categorias da loja.
CREATE OR REPLACE FUNCTION categorias_inexistentes_nuvemshop(p_schema_name TEXT, p_store_id BIGINT, p_ids BIGINT[])
RETURNS BIGINT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_faltam BIGINT[];
BEGIN
    EXECUTE format('
        SELECT COALESCE(array_agg(i), ARRAY[]::BIGINT[])
        FROM unnest($2) AS i
        WHERE NOT EXISTS (SELECT 1 FROM %I.nuvemshop_categorias c WHERE c.store_id = $1 AND c.id_categoria = i)
    ', p_schema_name) INTO v_faltam USING p_store_id, p_ids;
    RETURN v_faltam;
END;
$$;

-- Depois de gravar na Nuvemshop: reflete a marca e/ou as categorias do produto em todas as suas variantes.
CREATE OR REPLACE FUNCTION espelhar_marca_categoria_nuvemshop(
    p_schema_name TEXT, p_store_id BIGINT, p_id_produto BIGINT,
    p_atualizar_marca BOOLEAN, p_marca TEXT,
    p_atualizar_categorias BOOLEAN, p_categorias_ids BIGINT[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    EXECUTE format('
        UPDATE %I.nuvemshop_produtos SET
            marca = CASE WHEN $3 THEN NULLIF(btrim($4), '''') ELSE marca END,
            categorias_ids = CASE WHEN $5 THEN COALESCE($6, ARRAY[]::BIGINT[]) ELSE categorias_ids END
        WHERE store_id = $1 AND id_produto = $2
    ', p_schema_name) USING p_store_id, p_id_produto, p_atualizar_marca, p_marca, p_atualizar_categorias, p_categorias_ids;
END;
$$;

-- Auditoria: toda tentativa (sucesso ou falha) de alterar marca/categorias.
CREATE OR REPLACE FUNCTION registrar_alteracao_marca_categoria(
    p_schema_name TEXT, p_store_id BIGINT, p_id_produto_ns BIGINT,
    p_marca_anterior TEXT, p_marca_nova TEXT,
    p_categorias_anteriores BIGINT[], p_categorias_novas BIGINT[],
    p_sucesso BOOLEAN, p_erro TEXT, p_usuario_id UUID, p_usuario_email TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    EXECUTE format('
        INSERT INTO %I.nuvemshop_alteracoes_marca_categoria
            (store_id, id_produto_ns, marca_anterior, marca_nova, categorias_anteriores, categorias_novas, sucesso, erro, usuario_id, usuario_email)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ', p_schema_name) USING p_store_id, p_id_produto_ns, left(p_marca_anterior, 200), left(p_marca_nova, 200),
        p_categorias_anteriores, p_categorias_novas, p_sucesso, p_erro, p_usuario_id, p_usuario_email;
END;
$$;

-- Permissões: leitura pelo app (authenticated); o resto só service_role. Nada para anon/PUBLIC.
REVOKE ALL ON FUNCTION public.categorias_com_caminho_sql(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION obter_produtos_marca_categoria(TEXT, TEXT, TEXT, TEXT, BIGINT, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION obter_resumo_marca_categoria(TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION obter_categorias_nuvemshop(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION obter_marcas_nuvemshop(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION obter_produtos_marca_categoria(TEXT, TEXT, TEXT, TEXT, BIGINT, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION obter_resumo_marca_categoria(TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION obter_categorias_nuvemshop(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION obter_marcas_nuvemshop(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION registrar_marca_nuvemshop(TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION registrar_categoria_nuvemshop(TEXT, BIGINT, BIGINT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION categorias_inexistentes_nuvemshop(TEXT, BIGINT, BIGINT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION espelhar_marca_categoria_nuvemshop(TEXT, BIGINT, BIGINT, BOOLEAN, TEXT, BOOLEAN, BIGINT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION registrar_alteracao_marca_categoria(TEXT, BIGINT, BIGINT, TEXT, TEXT, BIGINT[], BIGINT[], BOOLEAN, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION registrar_marca_nuvemshop(TEXT, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION registrar_categoria_nuvemshop(TEXT, BIGINT, BIGINT, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION categorias_inexistentes_nuvemshop(TEXT, BIGINT, BIGINT[]) TO service_role;
GRANT EXECUTE ON FUNCTION espelhar_marca_categoria_nuvemshop(TEXT, BIGINT, BIGINT, BOOLEAN, TEXT, BOOLEAN, BIGINT[]) TO service_role;
GRANT EXECUTE ON FUNCTION registrar_alteracao_marca_categoria(TEXT, BIGINT, BIGINT, TEXT, TEXT, BIGINT[], BIGINT[], BOOLEAN, TEXT, UUID, TEXT) TO service_role;
