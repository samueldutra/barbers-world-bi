-- Comparação de preços com a concorrência (Google Shopping via SerpApi) — piloto.
--
-- Ao abrir um produto na listagem de Produtos, a rota /api/produtos/comparar-precos consulta o
-- Google Shopping (1 busca paga) e guarda o resultado aqui. Cada busca vira uma linha em
-- consultas_precos (mesmo sem resultados — serve de cache de 24 h e de contador do teto diário
-- de gasto) e seus resultados em consultas_precos_itens (histórico de preços da concorrência).
--
-- Todas as funções são SÓ do service_role (a rota de API confere o login e o módulo "Produtos"
-- antes): ver dashboard/sql/seguranca_revogar_acesso_publico.sql.

CREATE TABLE IF NOT EXISTS barbers.consultas_precos (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_produto       BIGINT NOT NULL,
    consulta         TEXT NOT NULL,
    consultado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    total_resultados INTEGER NOT NULL DEFAULT 0,
    criado_por       UUID
);

CREATE INDEX IF NOT EXISTS idx_consultas_precos_produto ON barbers.consultas_precos (id_produto, consultado_em DESC);
CREATE INDEX IF NOT EXISTS idx_consultas_precos_data ON barbers.consultas_precos (consultado_em);

CREATE TABLE IF NOT EXISTS barbers.consultas_precos_itens (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    consulta_id  UUID NOT NULL REFERENCES barbers.consultas_precos(id) ON DELETE CASCADE,
    posicao      INTEGER NOT NULL,
    loja         TEXT,
    titulo       TEXT NOT NULL,
    preco        NUMERIC(12, 2) NOT NULL,
    preco_texto  TEXT,
    link         TEXT,
    thumbnail    TEXT
);

CREATE INDEX IF NOT EXISTS idx_consultas_precos_itens_consulta ON barbers.consultas_precos_itens (consulta_id);

ALTER TABLE barbers.consultas_precos ENABLE ROW LEVEL SECURITY;
ALTER TABLE barbers.consultas_precos_itens ENABLE ROW LEVEL SECURITY;


-- Dados do produto pra montar a busca e comparar com o nosso preço.
CREATE OR REPLACE FUNCTION obter_produto_comparacao(p_schema_name TEXT, p_id_produto BIGINT)
RETURNS TABLE(id_produto BIGINT, codigo TEXT, nome TEXT, marca TEXT, preco NUMERIC, imagem_url TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT p.id_produto, p.codigo::TEXT, p.nome::TEXT, p.marca::TEXT, p.preco::NUMERIC, p.imagem_url::TEXT
        FROM %I.produtos p
        WHERE p.id_produto = %L
    ', p_schema_name, p_id_produto);
END;
$$;


-- Última consulta do produto (cabeçalho) — vazio se nunca foi consultado.
CREATE OR REPLACE FUNCTION obter_ultima_consulta_precos(p_schema_name TEXT, p_id_produto BIGINT)
RETURNS TABLE(id UUID, consulta TEXT, consultado_em TIMESTAMPTZ, total_resultados INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT c.id, c.consulta, c.consultado_em, c.total_resultados
        FROM %I.consultas_precos c
        WHERE c.id_produto = %L
        ORDER BY c.consultado_em DESC
        LIMIT 1
    ', p_schema_name, p_id_produto);
END;
$$;


CREATE OR REPLACE FUNCTION obter_itens_consulta_precos(p_schema_name TEXT, p_consulta_id UUID)
RETURNS TABLE(posicao INTEGER, loja TEXT, titulo TEXT, preco NUMERIC, preco_texto TEXT, link TEXT, thumbnail TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT i.posicao, i.loja, i.titulo, i.preco, i.preco_texto, i.link, i.thumbnail
        FROM %I.consultas_precos_itens i
        WHERE i.consulta_id = %L
        ORDER BY i.preco ASC, i.posicao ASC
    ', p_schema_name, p_consulta_id);
END;
$$;


-- Grava uma consulta e seus resultados (p_itens: [{posicao, loja, titulo, preco, precoTexto, link, thumbnail}]).
-- Devolve o id e o horário da consulta.
CREATE OR REPLACE FUNCTION salvar_consulta_precos(
    p_schema_name TEXT,
    p_id_produto BIGINT,
    p_consulta TEXT,
    p_itens JSONB,
    p_criado_por UUID DEFAULT NULL
)
RETURNS TABLE(id UUID, consultado_em TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
    v_quando TIMESTAMPTZ;
    v_total INTEGER := COALESCE(jsonb_array_length(p_itens), 0);
BEGIN
    EXECUTE format('
        INSERT INTO %I.consultas_precos (id_produto, consulta, total_resultados, criado_por)
        VALUES (%L, %L, %L, %L)
        RETURNING id, consultado_em
    ', p_schema_name, p_id_produto, p_consulta, v_total, p_criado_por) INTO v_id, v_quando;

    IF v_total > 0 THEN
        EXECUTE format('
            INSERT INTO %I.consultas_precos_itens (consulta_id, posicao, loja, titulo, preco, preco_texto, link, thumbnail)
            SELECT %L, (i->>''posicao'')::INT, i->>''loja'', i->>''titulo'', (i->>''preco'')::NUMERIC,
                   i->>''precoTexto'', i->>''link'', i->>''thumbnail''
            FROM jsonb_array_elements(%L::JSONB) AS i
        ', p_schema_name, v_id, p_itens);
    END IF;

    RETURN QUERY SELECT v_id, v_quando;
END;
$$;


-- Quantas buscas pagas já foram feitas hoje (dia de Brasília) — trava o gasto diário.
CREATE OR REPLACE FUNCTION contar_consultas_precos_hoje(p_schema_name TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total INTEGER;
BEGIN
    EXECUTE format('
        SELECT count(*)::INT FROM %I.consultas_precos
        WHERE consultado_em >= date_trunc(''day'', now() AT TIME ZONE ''America/Sao_Paulo'') AT TIME ZONE ''America/Sao_Paulo''
    ', p_schema_name) INTO v_total;
    RETURN v_total;
END;
$$;


DO $$
DECLARE
    f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'obter_produto_comparacao(TEXT, BIGINT)',
        'obter_ultima_consulta_precos(TEXT, BIGINT)',
        'obter_itens_consulta_precos(TEXT, UUID)',
        'salvar_consulta_precos(TEXT, BIGINT, TEXT, JSONB, UUID)',
        'contar_consultas_precos_hoje(TEXT)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
END $$;
