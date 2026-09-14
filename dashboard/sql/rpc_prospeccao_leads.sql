-- Módulo "Prospecção de Leads": mapeia estabelecimentos de um nicho (ex.: barbearias)
-- perto da Barbers World via OpenStreetMap (busca fica no server, ver
-- src/app/api/prospeccao/buscar/route.ts) e permite salvar cada um com um status
-- (cliente/concorrente/lead). Diferente das outras tabelas do schema barbers, essa não
-- vem do ETL do Bling — é dado nativo do app, criado direto pelo usuário na tela.

CREATE TABLE IF NOT EXISTS barbers.leads_mapeados (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Identificação do elemento no OpenStreetMap (pra deduplicar re-buscas). Nulo quando
    -- o lead for adicionado manualmente no futuro (sem origem OSM).
    osm_type        TEXT,
    osm_id          BIGINT,

    nome            TEXT NOT NULL,
    nicho           TEXT,
    endereco        TEXT,
    telefone        TEXT,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,

    status          TEXT NOT NULL DEFAULT 'lead' CHECK (status IN ('cliente', 'concorrente', 'lead')),
    observacoes     TEXT,

    criado_por      UUID,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice único parcial: só aplica dedupe quando o lead veio do OSM (osm_type/osm_id
-- preenchidos). Permite múltiplos leads manuais com esses campos NULL no futuro.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_mapeados_osm
    ON barbers.leads_mapeados (osm_type, osm_id)
    WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_mapeados_status
    ON barbers.leads_mapeados (status);


-- Lista os leads salvos, opcionalmente filtrado por status.
CREATE OR REPLACE FUNCTION obter_leads_mapeados(
    p_schema_name TEXT,
    p_status TEXT DEFAULT NULL
)
RETURNS TABLE(
    id BIGINT,
    osm_type TEXT,
    osm_id BIGINT,
    nome TEXT,
    nicho TEXT,
    endereco TEXT,
    telefone TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    status TEXT,
    observacoes TEXT,
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
        SELECT id, osm_type, osm_id, nome, nicho, endereco, telefone, latitude, longitude,
               status, observacoes, criado_em, atualizado_em
        FROM %I.leads_mapeados
        WHERE (%L::TEXT IS NULL OR status = %L)
        ORDER BY criado_em DESC
    ', p_schema_name, p_status, p_status);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_leads_mapeados(TEXT, TEXT) TO authenticated;


-- Salva (ou atualiza, se já mapeado) um resultado de busca com um status. Upsert por
-- (osm_type, osm_id) quando vem do OSM; senão insere direto (lead manual).
CREATE OR REPLACE FUNCTION salvar_lead_mapeado(
    p_schema_name TEXT,
    p_nome TEXT,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_osm_type TEXT DEFAULT NULL,
    p_osm_id BIGINT DEFAULT NULL,
    p_nicho TEXT DEFAULT NULL,
    p_endereco TEXT DEFAULT NULL,
    p_telefone TEXT DEFAULT NULL,
    p_status TEXT DEFAULT 'lead',
    p_observacoes TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
    v_id BIGINT;
    v_status TEXT;
BEGIN
    v_status := CASE WHEN p_status IN ('cliente', 'concorrente', 'lead') THEN p_status ELSE 'lead' END;

    IF p_osm_type IS NOT NULL AND p_osm_id IS NOT NULL THEN
        v_sql := format('
            INSERT INTO %I.leads_mapeados
                (osm_type, osm_id, nome, nicho, endereco, telefone, latitude, longitude, status, observacoes, criado_por)
            VALUES (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, auth.uid())
            ON CONFLICT (osm_type, osm_id) DO UPDATE SET
                nome = EXCLUDED.nome,
                nicho = COALESCE(EXCLUDED.nicho, %I.leads_mapeados.nicho),
                endereco = COALESCE(EXCLUDED.endereco, %I.leads_mapeados.endereco),
                telefone = COALESCE(EXCLUDED.telefone, %I.leads_mapeados.telefone),
                status = EXCLUDED.status,
                atualizado_em = now()
            RETURNING id
        ', p_schema_name, p_osm_type, p_osm_id, p_nome, p_nicho, p_endereco, p_telefone,
           p_latitude, p_longitude, v_status, p_observacoes,
           p_schema_name, p_schema_name, p_schema_name);
    ELSE
        v_sql := format('
            INSERT INTO %I.leads_mapeados
                (nome, nicho, endereco, telefone, latitude, longitude, status, observacoes, criado_por)
            VALUES (%L, %L, %L, %L, %L, %L, %L, %L, auth.uid())
            RETURNING id
        ', p_schema_name, p_nome, p_nicho, p_endereco, p_telefone, p_latitude, p_longitude, v_status, p_observacoes);
    END IF;

    EXECUTE v_sql INTO v_id;
    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION salvar_lead_mapeado(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION atualizar_status_lead_mapeado(
    p_schema_name TEXT,
    p_id BIGINT,
    p_status TEXT,
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
    IF p_status NOT IN ('cliente', 'concorrente', 'lead') THEN
        RAISE EXCEPTION 'status inválido: %', p_status;
    END IF;

    v_sql := format('
        UPDATE %I.leads_mapeados
        SET status = %L,
            observacoes = COALESCE(%L, observacoes),
            atualizado_em = now()
        WHERE id = %L
    ', p_schema_name, p_status, p_observacoes, p_id);

    EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION atualizar_status_lead_mapeado(TEXT, BIGINT, TEXT, TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION excluir_lead_mapeado(p_schema_name TEXT, p_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('DELETE FROM %I.leads_mapeados WHERE id = %L', p_schema_name, p_id);
    EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION excluir_lead_mapeado(TEXT, BIGINT) TO authenticated;
