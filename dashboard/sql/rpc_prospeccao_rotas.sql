-- Módulo "Prospecção de Leads" — Rotas de visita: permite selecionar um conjunto de leads
-- mapeados (pelo mapa ou pela lista) e salvar como uma rota nomeada, com paradas em ordem
-- e checklist de "visita realizada" por parada. Complementa o botão "Gerar rota" (que só
-- abre o link do Google Maps sem persistir nada) — aqui a rota vira um registro que pode
-- ser reaberto, acompanhado e marcado como concluído depois da visita.

CREATE TABLE IF NOT EXISTS barbers.rotas_visita (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome            TEXT NOT NULL,
    descricao       TEXT,
    status          TEXT NOT NULL DEFAULT 'planejada'
                        CHECK (status IN ('planejada', 'em_andamento', 'concluida', 'cancelada')),
    criado_por      UUID,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Parada = 1 lead dentro de 1 rota, com a ordem de visita e o checklist. ON DELETE CASCADE
-- nas duas FKs: apagar a rota apaga as paradas; apagar o lead (raro, só se o usuário
-- excluir da lista de leads) apaga a parada correspondente, não a rota inteira.
CREATE TABLE IF NOT EXISTS barbers.rotas_visita_paradas (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rota_id             BIGINT NOT NULL REFERENCES barbers.rotas_visita(id) ON DELETE CASCADE,
    lead_id             BIGINT NOT NULL REFERENCES barbers.leads_mapeados(id) ON DELETE CASCADE,
    ordem               INTEGER NOT NULL,
    visita_realizada    BOOLEAN NOT NULL DEFAULT false,
    visitado_em         TIMESTAMPTZ,
    observacoes         TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rotas_visita_paradas_rota_lead
    ON barbers.rotas_visita_paradas (rota_id, lead_id);

CREATE INDEX IF NOT EXISTS idx_rotas_visita_paradas_rota
    ON barbers.rotas_visita_paradas (rota_id, ordem);


-- Lista as rotas salvas com um resumo de progresso (contagem de paradas/visitadas) — a
-- tela usa isso pra montar o card de cada rota sem precisar buscar as paradas de todas.
CREATE OR REPLACE FUNCTION obter_rotas_visita(p_schema_name TEXT)
RETURNS TABLE(
    id BIGINT,
    nome TEXT,
    descricao TEXT,
    status TEXT,
    total_paradas BIGINT,
    paradas_visitadas BIGINT,
    criado_em TIMESTAMPTZ,
    atualizado_em TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT
            r.id, r.nome, r.descricao, r.status,
            count(p.id)::BIGINT AS total_paradas,
            count(p.id) FILTER (WHERE p.visita_realizada)::BIGINT AS paradas_visitadas,
            r.criado_em, r.atualizado_em
        FROM %I.rotas_visita r
        LEFT JOIN %I.rotas_visita_paradas p ON p.rota_id = r.id
        GROUP BY r.id
        ORDER BY r.criado_em DESC
    ', p_schema_name, p_schema_name);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_rotas_visita(TEXT) TO authenticated;


-- Paradas de 1 rota específica, já com os dados do lead (nome/endereço/telefone/posição)
-- pra desenhar no mapa e montar o link do Google Maps sem round-trip extra.
-- DROP explícito: CREATE OR REPLACE não muda o conjunto de colunas de RETURNS TABLE
-- (adicionamos "cidade" depois da v1 dessa função).
DROP FUNCTION IF EXISTS obter_rota_visita_paradas(TEXT, BIGINT);

CREATE OR REPLACE FUNCTION obter_rota_visita_paradas(p_schema_name TEXT, p_rota_id BIGINT)
RETURNS TABLE(
    parada_id BIGINT,
    lead_id BIGINT,
    ordem INTEGER,
    visita_realizada BOOLEAN,
    visitado_em TIMESTAMPTZ,
    observacoes TEXT,
    nome TEXT,
    endereco TEXT,
    cidade TEXT,
    telefone TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    status_lead TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT
            p.id, p.lead_id, p.ordem, p.visita_realizada, p.visitado_em, p.observacoes,
            l.nome, l.endereco, l.cidade, l.telefone, l.latitude, l.longitude, l.status
        FROM %I.rotas_visita_paradas p
        JOIN %I.leads_mapeados l ON l.id = p.lead_id
        WHERE p.rota_id = %L
        ORDER BY p.ordem
    ', p_schema_name, p_schema_name, p_rota_id);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_rota_visita_paradas(TEXT, BIGINT) TO authenticated;


-- Cria a rota + as paradas em lote, na ordem em que p_lead_ids veio (a tela monta esse
-- array pela ordem de seleção no mapa/lista). unnest(...) WITH ORDINALITY gera a coluna de
-- ordem a partir da posição no array.
CREATE OR REPLACE FUNCTION salvar_rota_visita(
    p_schema_name TEXT,
    p_nome TEXT,
    p_lead_ids BIGINT[],
    p_descricao TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
    v_rota_id BIGINT;
BEGIN
    IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'informe pelo menos 1 lead pra montar a rota';
    END IF;
    IF p_nome IS NULL OR trim(p_nome) = '' THEN
        RAISE EXCEPTION 'informe um nome pra rota';
    END IF;

    v_sql := format('
        INSERT INTO %I.rotas_visita (nome, descricao, criado_por)
        VALUES (%L, %L, auth.uid())
        RETURNING id
    ', p_schema_name, p_nome, p_descricao);
    EXECUTE v_sql INTO v_rota_id;

    v_sql := format('
        INSERT INTO %I.rotas_visita_paradas (rota_id, lead_id, ordem)
        SELECT %L, t.lead_id, t.ordem
        FROM unnest(%L::BIGINT[]) WITH ORDINALITY AS t(lead_id, ordem)
    ', p_schema_name, v_rota_id, p_lead_ids);
    EXECUTE v_sql;

    RETURN v_rota_id;
END;
$$;

GRANT EXECUTE ON FUNCTION salvar_rota_visita(TEXT, TEXT, BIGINT[], TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION atualizar_status_rota_visita(
    p_schema_name TEXT,
    p_id BIGINT,
    p_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    IF p_status NOT IN ('planejada', 'em_andamento', 'concluida', 'cancelada') THEN
        RAISE EXCEPTION 'status de rota inválido: %', p_status;
    END IF;

    v_sql := format('
        UPDATE %I.rotas_visita
        SET status = %L, atualizado_em = now()
        WHERE id = %L
    ', p_schema_name, p_status, p_id);

    EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION atualizar_status_rota_visita(TEXT, BIGINT, TEXT) TO authenticated;


-- Marca/desmarca uma parada como visitada — visitado_em anda junto (carimba ao marcar,
-- limpa ao desmarcar), assim a tela não precisa mandar a data separada.
CREATE OR REPLACE FUNCTION atualizar_parada_rota_visita(
    p_schema_name TEXT,
    p_parada_id BIGINT,
    p_visita_realizada BOOLEAN,
    p_observacoes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        UPDATE %I.rotas_visita_paradas
        SET visita_realizada = %L,
            visitado_em = CASE WHEN %L THEN now() ELSE NULL END,
            observacoes = COALESCE(%L, observacoes)
        WHERE id = %L
    ', p_schema_name, p_visita_realizada, p_visita_realizada, p_observacoes, p_parada_id);

    EXECUTE v_sql;

    v_sql := format('
        UPDATE %I.rotas_visita r
        SET atualizado_em = now()
        FROM %I.rotas_visita_paradas p
        WHERE p.id = %L AND p.rota_id = r.id
    ', p_schema_name, p_schema_name, p_parada_id);

    EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION atualizar_parada_rota_visita(TEXT, BIGINT, BOOLEAN, TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION excluir_rota_visita(p_schema_name TEXT, p_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('DELETE FROM %I.rotas_visita WHERE id = %L', p_schema_name, p_id);
    EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION excluir_rota_visita(TEXT, BIGINT) TO authenticated;
