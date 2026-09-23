-- Módulo "Conferência de Preços": compara o preço de cadastro no Bling (produtos.preco,
-- mantido em dia pela listagem de ativos do sync-produtos-bling.py) com o preço da última
-- venda nos canais escolhidos, e registra as alterações de preço feitas pela tela (que
-- grava no Bling via src/app/api/conferencia-precos/alterar).
--
-- Preço de referência = PREÇO CHEIO da última venda: valor_unitario_item vem do Bling já
-- líquido do desconto do item (conferido: 185 de 246 itens com desconto batem com
-- valor / (1 - desconto%) = preço de cadastro), então o cheio é recomposto dividindo pelo
-- desconto. Venda com 100% de desconto (brinde) não serve de referência e é ignorada.

-- Substitui obter_produtos_precos (primeira versão, sem filtro de canal nem preço cheio).
DROP FUNCTION IF EXISTS obter_produtos_precos(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER);


-- Auditoria das alterações feitas pela tela: quem mudou, de quanto pra quanto, por qual
-- critério, e se o Bling aceitou (falha também é registrada, com a mensagem).
CREATE TABLE IF NOT EXISTS barbers.produtos_alteracoes_preco (
    id              BIGSERIAL PRIMARY KEY,
    id_produto      BIGINT NOT NULL,
    preco_anterior  DECIMAL(15,2),
    preco_novo      DECIMAL(15,2) NOT NULL,
    origem          VARCHAR(20) NOT NULL,   -- 'ultima_venda' | 'manual'
    sucesso         BOOLEAN NOT NULL,
    erro            TEXT,
    usuario_id      UUID,
    usuario_email   TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_produtos_alteracoes_preco_produto
    ON barbers.produtos_alteracoes_preco (id_produto, criado_em DESC);

-- Só acessada via RPC SECURITY DEFINER (schema barbers não é exposto no PostgREST).
ALTER TABLE barbers.produtos_alteracoes_preco ENABLE ROW LEVEL SECURITY;


-- Listagem da conferência, paginada server-side (o Supabase corta RPC em ~1000 linhas)
-- com total_registros replicado em cada linha, como obter_relatorio_vendas_produtos.
DROP FUNCTION IF EXISTS obter_conferencia_precos(TEXT, BIGINT[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION obter_conferencia_precos(
    p_schema_name TEXT,
    p_canais BIGINT[] DEFAULT NULL,   -- canais cuja última venda serve de referência; NULL = todos
    p_descricao TEXT DEFAULT NULL,    -- busca no nome do produto
    p_sku TEXT DEFAULT NULL,          -- busca no código (SKU)
    p_marca TEXT DEFAULT NULL,        -- NULL = "Todos"; valor deve bater com obter_marcas_produtos()
    p_categoria TEXT DEFAULT NULL,    -- NULL = "Todos"; valor deve bater com obter_categorias_produtos()
    p_status TEXT DEFAULT 'todos',    -- 'todos' | 'divergentes' | 'ultima_venda_menor' | 'alterados'
    p_ordenar_por TEXT DEFAULT 'nome', -- 'nome' | 'preco_atual' | 'preco_ultima_venda' | 'diferenca_percentual' | 'data_ultima_venda' | 'data_alteracao_preco'
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
    preco_atual NUMERIC,
    preco_anterior NUMERIC,                 -- NULL = sem mudança de preço registrada
    data_alteracao_preco TIMESTAMPTZ,
    preco_ultima_venda NUMERIC,             -- preço cheio (antes do desconto do item)
    valor_pago_ultima_venda NUMERIC,        -- valor efetivamente cobrado (com desconto)
    desconto_ultima_venda NUMERIC,          -- % de desconto do item
    data_ultima_venda DATE,
    numero_pedido_ultima_venda INTEGER,
    canal_ultima_venda TEXT,
    diferenca_percentual NUMERIC,           -- (preco_ultima_venda / preco_atual - 1) * 100
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
    v_descricao TEXT;
    v_sku TEXT;
    v_offset INTEGER;
BEGIN
    v_ordenar_coluna := CASE p_ordenar_por
        WHEN 'preco_atual' THEN 'preco_atual'
        WHEN 'preco_ultima_venda' THEN 'preco_ultima_venda'
        WHEN 'diferenca_percentual' THEN 'diferenca_percentual'
        WHEN 'data_ultima_venda' THEN 'data_ultima_venda'
        WHEN 'data_alteracao_preco' THEN 'data_alteracao_preco'
        ELSE 'nome'
    END;
    v_ordenar_direcao := CASE lower(p_ordenar_direcao) WHEN 'desc' THEN 'DESC' ELSE 'ASC' END;
    v_descricao := CASE WHEN p_descricao IS NULL OR trim(p_descricao) = '' THEN NULL ELSE '%' || trim(p_descricao) || '%' END;
    v_sku := CASE WHEN p_sku IS NULL OR trim(p_sku) = '' THEN NULL ELSE '%' || trim(p_sku) || '%' END;
    v_offset := (GREATEST(p_pagina, 1) - 1) * GREATEST(p_tamanho_pagina, 1);

    v_sql := format('
        WITH ultima_venda AS (
            SELECT DISTINCT ON (pv.id_produto)
                pv.id_produto,
                pv.valor_unitario_item,
                COALESCE(pv.desconto_item_percentual, 0) AS desconto,
                pv.data,
                pv.numero,
                pv.id_loja
            FROM %I.pedidos_vendas pv
            WHERE pv.id_produto IS NOT NULL
              AND pv.id_situacao = ANY(situacoes_validas_faturamento())
              AND COALESCE(pv.desconto_item_percentual, 0) < 100
              AND (%L::BIGINT[] IS NULL OR pv.id_loja = ANY(%L::BIGINT[]))
            ORDER BY pv.id_produto, pv.data DESC, pv.id_pedido DESC, pv.id_item DESC
        ),
        base AS (
            SELECT
                p.id_produto,
                p.codigo::TEXT AS codigo,
                p.nome::TEXT AS nome,
                NULLIF(TRIM(p.marca), '''')::TEXT AS marca,
                NULLIF(TRIM(p.categoria_descricao), '''')::TEXT AS categoria_descricao,
                p.imagem_url::TEXT AS imagem_url,
                p.preco::NUMERIC AS preco_atual,
                p.preco_anterior::NUMERIC AS preco_anterior,
                p.data_alteracao_preco,
                round(uv.valor_unitario_item / (1 - uv.desconto / 100), 2)::NUMERIC AS preco_ultima_venda,
                uv.valor_unitario_item::NUMERIC AS valor_pago_ultima_venda,
                uv.desconto::NUMERIC AS desconto_ultima_venda,
                uv.data AS data_ultima_venda,
                uv.numero AS numero_pedido_ultima_venda,
                COALESCE(cv.descricao, ''Canal '' || uv.id_loja)::TEXT AS canal_ultima_venda
            FROM %I.produtos p
            LEFT JOIN ultima_venda uv ON uv.id_produto = p.id_produto
            LEFT JOIN %I.canais_venda cv ON cv.id_loja = uv.id_loja
            WHERE p.situacao = ''A''
              AND (%L::TEXT IS NULL OR p.nome ILIKE %L)
              AND (%L::TEXT IS NULL OR p.codigo ILIKE %L)
              AND (%L::TEXT IS NULL OR COALESCE(NULLIF(TRIM(p.marca), ''''), ''Sem marca'') = %L)
              AND (%L::TEXT IS NULL OR COALESCE(NULLIF(TRIM(p.categoria_descricao), ''''), ''Sem categoria'') = %L)
        ),
        com_diferenca AS (
            SELECT
                b.*,
                CASE WHEN b.preco_atual > 0 AND b.preco_ultima_venda IS NOT NULL
                     THEN round((b.preco_ultima_venda / b.preco_atual - 1) * 100, 2)
                END::NUMERIC AS diferenca_percentual
            FROM base b
        )
        SELECT *, count(*) OVER()::BIGINT AS total_registros
        FROM com_diferenca
        WHERE CASE %L
                WHEN ''divergentes'' THEN preco_ultima_venda IS NOT NULL
                                      AND abs(preco_ultima_venda - COALESCE(preco_atual, 0)) >= 0.01
                -- Vendeu abaixo do cadastro (preço cheio, já sem o desconto do item).
                WHEN ''ultima_venda_menor'' THEN preco_ultima_venda IS NOT NULL
                                             AND preco_ultima_venda <= COALESCE(preco_atual, 0) - 0.01
                WHEN ''alterados'' THEN data_alteracao_preco IS NOT NULL
                ELSE TRUE
              END
        ORDER BY %I %s NULLS LAST, id_produto
        LIMIT %L OFFSET %L
    ', p_schema_name, p_canais, p_canais,
       p_schema_name, p_schema_name,
       v_descricao, v_descricao, v_sku, v_sku,
       p_marca, p_marca, p_categoria, p_categoria,
       p_status, v_ordenar_coluna, v_ordenar_direcao, p_tamanho_pagina, v_offset);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

REVOKE EXECUTE ON FUNCTION obter_conferencia_precos(TEXT, BIGINT[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION obter_conferencia_precos(TEXT, BIGINT[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;


-- Chamada pela rota de API depois de cada PATCH no Bling (sucesso ou falha). Em caso de
-- sucesso já reflete o preço novo em produtos (sem esperar o próximo sync), carimbando
-- preco_anterior/data_alteracao_preco — o sync seguinte vê o mesmo preço e não registra
-- de novo. Só service_role: quem chama é o servidor, depois de validar a permissão.
CREATE OR REPLACE FUNCTION registrar_alteracao_preco(
    p_schema_name TEXT,
    p_id_produto BIGINT,
    p_preco_anterior NUMERIC,
    p_preco_novo NUMERIC,
    p_origem TEXT,
    p_sucesso BOOLEAN,
    p_erro TEXT,
    p_usuario_id UUID,
    p_usuario_email TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    EXECUTE format('
        INSERT INTO %I.produtos_alteracoes_preco
            (id_produto, preco_anterior, preco_novo, origem, sucesso, erro, usuario_id, usuario_email)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ', p_schema_name)
    USING p_id_produto, p_preco_anterior, p_preco_novo, p_origem, p_sucesso, p_erro, p_usuario_id, p_usuario_email;

    IF p_sucesso THEN
        EXECUTE format('
            UPDATE %I.produtos
            SET preco_anterior = preco,
                data_alteracao_preco = now(),
                preco = $2
            WHERE id_produto = $1
              AND preco IS DISTINCT FROM $2
        ', p_schema_name)
        USING p_id_produto, p_preco_novo;
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION registrar_alteracao_preco(TEXT, BIGINT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION registrar_alteracao_preco(TEXT, BIGINT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, UUID, TEXT) TO service_role;
