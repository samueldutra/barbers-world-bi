-- Módulo "Prospecção de Leads" — Cidades do Brasil e mapeamento automático de uma cidade inteira.
--
-- 1) barbers.cidades: os 5.571 municípios do IBGE (nome + UF + estado). Alimenta a escolha de
--    cidade em Rotas > Nova rota, inclusive cidades que ainda não têm nenhum lead mapeado.
--    Carga inicial (feita em 09/10/2026): extensão pg_net (habilitada só durante a carga e
--    removida em seguida) disparando net.http_get em
--    https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios (uma
--    chamada por UF) e INSERT ... ON CONFLICT (id_ibge) DO UPDATE lendo net._http_response;
--    nome_busca = translate(lower(nome), 'áàâãä...', 'aaaaa...'). Pra recarregar, repetir.
-- 2) barbers.cidades_mapeamento: fila de "mapear todas as barbearias da cidade" (consulta em
--    segundo plano no Google Places, em círculos que cobrem a cidade toda). Ao terminar, a
--    rota que estava em "mapeando" recebe as paradas e passa a "planejada".
-- 3) leads_mapeados.uf: o nome da cidade sozinho é ambíguo (há várias "Bom Jesus"); o par
--    cidade + UF identifica o município.

-- ---------------------------------------------------------------------------
-- Cidades
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS barbers.cidades (
    id_ibge     INTEGER PRIMARY KEY,
    nome        TEXT NOT NULL,
    uf          CHAR(2) NOT NULL,
    estado      TEXT NOT NULL,
    -- nome em minúsculas e sem acento, pra busca ("maringa" acha "Maringá").
    nome_busca  TEXT NOT NULL,
    -- Preenchida quando o mapeamento COMPLETO da cidade termina.
    mapeada_em  TIMESTAMPTZ,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cidades_nome_busca ON barbers.cidades (nome_busca text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_cidades_uf ON barbers.cidades (uf);

ALTER TABLE barbers.cidades ENABLE ROW LEVEL SECURITY;

-- UF dos leads (vem do Google Places, administrative_area_level_1).
ALTER TABLE barbers.leads_mapeados ADD COLUMN IF NOT EXISTS uf TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_mapeados_cidade_uf ON barbers.leads_mapeados (lower(cidade), uf);


-- (obter_leads_mapeados e salvar_leads_novos, que agora trazem a UF, estão em rpc_prospeccao_leads.sql.)

-- ---------------------------------------------------------------------------
-- Busca de cidades (Rotas > Nova rota): todas as do Brasil, com leads já mapeados.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION buscar_cidades(
    p_schema_name TEXT,
    p_busca TEXT DEFAULT NULL,
    p_limite INT DEFAULT 30
)
RETURNS TABLE(
    id_ibge INTEGER,
    nome TEXT,
    uf TEXT,
    estado TEXT,
    total_leads BIGINT,
    mapeada_em TIMESTAMPTZ,
    mapeamento_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
    -- minúsculas e sem acento, igual ao nome_busca gravado em cidades
    v_busca TEXT := translate(lower(trim(COALESCE(p_busca, ''))), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
BEGIN
    v_sql := format('
        SELECT
            c.id_ibge,
            c.nome,
            c.uf::TEXT,
            c.estado,
            (SELECT count(*) FROM %1$I.leads_mapeados l WHERE lower(l.cidade) = lower(c.nome) AND l.uf = c.uf)::BIGINT AS total_leads,
            c.mapeada_em,
            (SELECT m.status FROM %1$I.cidades_mapeamento m WHERE m.id_ibge = c.id_ibge ORDER BY m.id DESC LIMIT 1)::TEXT
        FROM %1$I.cidades c
        WHERE (%2$L = '''' OR c.nome_busca LIKE ''%%'' || %2$L || ''%%'' OR lower(c.uf) = %2$L)
        ORDER BY 5 DESC, (c.nome_busca LIKE %2$L || ''%%'') DESC, c.nome
        LIMIT %3$L
    ', p_schema_name, v_busca, p_limite);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION buscar_cidades(TEXT, TEXT, INT) TO authenticated;


-- Leads de uma cidade (cidade + UF), pra montar a rota.
CREATE OR REPLACE FUNCTION obter_leads_da_cidade(p_schema_name TEXT, p_id_ibge INTEGER)
RETURNS TABLE(id BIGINT, nome TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT l.id, l.nome, l.latitude, l.longitude
        FROM %1$I.leads_mapeados l
        JOIN %1$I.cidades c ON lower(l.cidade) = lower(c.nome) AND l.uf = c.uf
        WHERE c.id_ibge = %2$L
        ORDER BY l.id
    ', p_schema_name, p_id_ibge);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_leads_da_cidade(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION obter_leads_da_cidade(TEXT, INTEGER) TO service_role;


-- ---------------------------------------------------------------------------
-- Mapeamento em segundo plano
-- ---------------------------------------------------------------------------
-- A rota nasce em 'mapeando' (sem paradas) e vira 'planejada' quando o mapeamento termina.
ALTER TABLE barbers.rotas_visita DROP CONSTRAINT IF EXISTS rotas_visita_status_check;
ALTER TABLE barbers.rotas_visita ADD CONSTRAINT rotas_visita_status_check
    CHECK (status IN ('planejada', 'em_andamento', 'concluida', 'cancelada', 'mapeando', 'erro_mapeamento'));

CREATE TABLE IF NOT EXISTS barbers.cidades_mapeamento (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_ibge                 INTEGER NOT NULL REFERENCES barbers.cidades(id_ibge),
    status                  TEXT NOT NULL DEFAULT 'pendente'
                                CHECK (status IN ('pendente', 'mapeando', 'concluido', 'erro')),
    nicho                   TEXT NOT NULL DEFAULT 'barbearia',
    -- Segredo da continuação em cadeia (/api/prospeccao/cidades/continuar): quem não tem o
    -- token não consegue disparar o processamento.
    token                   UUID NOT NULL DEFAULT gen_random_uuid(),
    -- Áreas de busca ainda por fazer: [{lat, lon, hx, hy, t}] (retângulo de centro lat/lon e meios-lados
    -- hx/hy em metros; t = tentativas). A busca usa o círculo que circunscreve cada retângulo.
    fila                    JSONB NOT NULL DEFAULT '[]'::JSONB,
    circulos_total          INTEGER NOT NULL DEFAULT 0,
    circulos_processados    INTEGER NOT NULL DEFAULT 0,
    leads_novos             INTEGER NOT NULL DEFAULT 0,
    -- true quando algum círculo deu erro/estourou o teto e a cobertura pode ter ficado incompleta.
    parcial                 BOOLEAN NOT NULL DEFAULT false,
    erro                    TEXT,
    rota_id                 BIGINT REFERENCES barbers.rotas_visita(id) ON DELETE SET NULL,
    ponto_lat               DOUBLE PRECISION,
    ponto_lon               DOUBLE PRECISION,
    criado_por              UUID,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE barbers.cidades_mapeamento ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_cidades_mapeamento_cidade ON barbers.cidades_mapeamento (id_ibge, id DESC);
CREATE INDEX IF NOT EXISTS idx_cidades_mapeamento_status ON barbers.cidades_mapeamento (status);


-- Cria o mapeamento + a rota "mapeando" (já visível na lista). SÓ o servidor chama (service_role),
-- depois de conferir o módulo de Prospecção do usuário (rota /api/prospeccao/cidades/mapear);
-- o usuário vai em p_criado_por. Um mapeamento ativo por cidade: evita pagar duas vezes a mesma busca.
DROP FUNCTION IF EXISTS iniciar_mapeamento_cidade(TEXT, INTEGER, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION);
CREATE OR REPLACE FUNCTION iniciar_mapeamento_cidade(
    p_schema_name TEXT,
    p_id_ibge INTEGER,
    p_rota_nome TEXT,
    p_rota_descricao TEXT DEFAULT NULL,
    p_ponto_partida_endereco TEXT DEFAULT NULL,
    p_ponto_lat DOUBLE PRECISION DEFAULT NULL,
    p_ponto_lon DOUBLE PRECISION DEFAULT NULL,
    p_criado_por UUID DEFAULT NULL
)
RETURNS TABLE(job_id BIGINT, rota_id BIGINT, token UUID, cidade TEXT, uf TEXT, estado TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ativo BIGINT;
    v_rota BIGINT;
    v_job BIGINT;
    v_token UUID;
    v_nome TEXT;
    v_uf TEXT;
    v_estado TEXT;
BEGIN
    IF p_rota_nome IS NULL OR trim(p_rota_nome) = '' THEN
        RAISE EXCEPTION 'informe um nome pra rota';
    END IF;

    EXECUTE format('SELECT nome, uf::TEXT, estado FROM %I.cidades WHERE id_ibge = %L', p_schema_name, p_id_ibge)
        INTO v_nome, v_uf, v_estado;
    IF v_nome IS NULL THEN
        RAISE EXCEPTION 'cidade não encontrada';
    END IF;

    EXECUTE format('SELECT id FROM %I.cidades_mapeamento WHERE id_ibge = %L AND status IN (''pendente'', ''mapeando'') LIMIT 1',
                   p_schema_name, p_id_ibge) INTO v_ativo;
    IF v_ativo IS NOT NULL THEN
        RAISE EXCEPTION 'já existe um mapeamento em andamento para %', v_nome;
    END IF;

    EXECUTE format('
        INSERT INTO %I.rotas_visita (nome, descricao, ponto_partida_endereco, status, criado_por)
        VALUES (%L, %L, %L, ''mapeando'', %L)
        RETURNING id
    ', p_schema_name, p_rota_nome, p_rota_descricao, p_ponto_partida_endereco, p_criado_por) INTO v_rota;

    EXECUTE format('
        INSERT INTO %I.cidades_mapeamento (id_ibge, status, rota_id, ponto_lat, ponto_lon, criado_por)
        VALUES (%L, ''pendente'', %L, %L, %L, %L)
        RETURNING id, token
    ', p_schema_name, p_id_ibge, v_rota, p_ponto_lat, p_ponto_lon, p_criado_por) INTO v_job, v_token;

    RETURN QUERY SELECT v_job, v_rota, v_token, v_nome, v_uf, v_estado;
END;
$$;

-- Daqui pra baixo: só o servidor (service_role) chama.
CREATE OR REPLACE FUNCTION obter_mapeamento_cidade(p_schema_name TEXT, p_job_id BIGINT)
RETURNS TABLE(
    id BIGINT, id_ibge INTEGER, cidade TEXT, uf TEXT, estado TEXT, status TEXT, nicho TEXT, token UUID,
    fila JSONB, circulos_total INTEGER, circulos_processados INTEGER, leads_novos INTEGER, parcial BOOLEAN,
    rota_id BIGINT, ponto_lat DOUBLE PRECISION, ponto_lon DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT m.id, m.id_ibge, c.nome, c.uf::TEXT, c.estado, m.status, m.nicho, m.token,
               m.fila, m.circulos_total, m.circulos_processados, m.leads_novos, m.parcial,
               m.rota_id, m.ponto_lat, m.ponto_lon
        FROM %1$I.cidades_mapeamento m
        JOIN %1$I.cidades c ON c.id_ibge = m.id_ibge
        WHERE m.id = %2$L
    ', p_schema_name, p_job_id);
END;
$$;

CREATE OR REPLACE FUNCTION salvar_progresso_mapeamento(
    p_schema_name TEXT,
    p_job_id BIGINT,
    p_fila JSONB,
    p_circulos_total INTEGER,
    p_circulos_processados INTEGER,
    p_leads_novos_somar INTEGER DEFAULT 0,
    p_status TEXT DEFAULT 'mapeando',
    p_parcial BOOLEAN DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    EXECUTE format('
        UPDATE %I.cidades_mapeamento
        SET fila = %L::JSONB, circulos_total = %L, circulos_processados = %L,
            leads_novos = leads_novos + %L, status = %L,
            parcial = COALESCE(%L::BOOLEAN, parcial), atualizado_em = now()
        WHERE id = %L
    ', p_schema_name, p_fila, p_circulos_total, p_circulos_processados, p_leads_novos_somar, p_status, p_parcial, p_job_id);
END;
$$;

-- Fim do mapeamento: grava as paradas (na ordem do array), a rota vira "planejada" e a
-- cidade fica marcada como mapeada.
DROP FUNCTION IF EXISTS concluir_mapeamento_cidade(TEXT, BIGINT, BIGINT[]);
CREATE OR REPLACE FUNCTION concluir_mapeamento_cidade(p_schema_name TEXT, p_job_id BIGINT, p_lead_ids BIGINT[], p_parcial BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rota BIGINT;
    v_cidade INTEGER;
BEGIN
    EXECUTE format('SELECT rota_id, id_ibge FROM %I.cidades_mapeamento WHERE id = %L', p_schema_name, p_job_id)
        INTO v_rota, v_cidade;

    IF v_rota IS NOT NULL AND p_lead_ids IS NOT NULL AND array_length(p_lead_ids, 1) IS NOT NULL THEN
        EXECUTE format('
            INSERT INTO %I.rotas_visita_paradas (rota_id, lead_id, ordem)
            SELECT %L, t.lead_id, t.ordem
            FROM unnest(%L::BIGINT[]) WITH ORDINALITY AS t(lead_id, ordem)
            ON CONFLICT (rota_id, lead_id) DO NOTHING
        ', p_schema_name, v_rota, p_lead_ids);
    END IF;

    IF v_rota IS NOT NULL THEN
        -- Cidade grande demais pro teto de buscas: avisa na própria rota que o mapeamento ficou parcial.
        EXECUTE format('UPDATE %I.rotas_visita SET status = ''planejada'', atualizado_em = now(),
                        descricao = CASE WHEN %L::BOOLEAN THEN COALESCE(descricao || '' · '', '''') || ''mapeamento parcial (cidade muito grande)'' ELSE descricao END
                        WHERE id = %L', p_schema_name, p_parcial, v_rota);
    END IF;

    EXECUTE format('UPDATE %I.cidades_mapeamento SET status = ''concluido'', parcial = %L, fila = ''[]''::JSONB, atualizado_em = now() WHERE id = %L',
                   p_schema_name, p_parcial, p_job_id);
    -- Só marca a cidade como mapeada quando a cobertura foi completa; parcial pode ser refeita depois.
    IF NOT p_parcial THEN
        EXECUTE format('UPDATE %I.cidades SET mapeada_em = now() WHERE id_ibge = %L', p_schema_name, v_cidade);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION falhar_mapeamento_cidade(p_schema_name TEXT, p_job_id BIGINT, p_erro TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rota BIGINT;
BEGIN
    EXECUTE format('SELECT rota_id FROM %I.cidades_mapeamento WHERE id = %L', p_schema_name, p_job_id) INTO v_rota;
    EXECUTE format('UPDATE %I.cidades_mapeamento SET status = ''erro'', erro = %L, atualizado_em = now() WHERE id = %L',
                   p_schema_name, left(p_erro, 500), p_job_id);
    IF v_rota IS NOT NULL THEN
        EXECUTE format('UPDATE %I.rotas_visita SET status = ''erro_mapeamento'', atualizado_em = now() WHERE id = %L',
                       p_schema_name, v_rota);
    END IF;
END;
$$;

-- Mapeamentos "mapeando" sem progresso há mais de N segundos (a cadeia de continuação caiu).
CREATE OR REPLACE FUNCTION listar_mapeamentos_travados(p_schema_name TEXT, p_segundos INTEGER DEFAULT 90)
RETURNS TABLE(id BIGINT, token UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT id, token FROM %I.cidades_mapeamento
        WHERE status IN (''pendente'', ''mapeando'') AND atualizado_em < now() - make_interval(secs => %L)
    ', p_schema_name, p_segundos);
END;
$$;

-- Reivindica um mapeamento parado de forma atômica: só uma chamada simultânea de "retomar"
-- ganha (evita processar e pagar a mesma busca duas vezes).
CREATE OR REPLACE FUNCTION reivindicar_mapeamento_cidade(p_schema_name TEXT, p_job_id BIGINT, p_segundos INTEGER DEFAULT 90)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    EXECUTE format('
        UPDATE %I.cidades_mapeamento SET atualizado_em = now()
        WHERE id = %L AND status IN (''pendente'', ''mapeando'') AND atualizado_em < now() - make_interval(secs => %L)
        RETURNING id', p_schema_name, p_job_id, p_segundos) INTO v_id;
    RETURN v_id IS NOT NULL;
END;
$$;

DO $$
DECLARE
    f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'reivindicar_mapeamento_cidade(TEXT, BIGINT, INTEGER)',
        'iniciar_mapeamento_cidade(TEXT, INTEGER, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, UUID)',
        'obter_mapeamento_cidade(TEXT, BIGINT)',
        'salvar_progresso_mapeamento(TEXT, BIGINT, JSONB, INTEGER, INTEGER, INTEGER, TEXT, BOOLEAN)',
        'concluir_mapeamento_cidade(TEXT, BIGINT, BIGINT[], BOOLEAN)',
        'falhar_mapeamento_cidade(TEXT, BIGINT, TEXT)',
        'listar_mapeamentos_travados(TEXT, INTEGER)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
END $$;

-- UF dos leads que já existiam antes da coluna (todos de cidades do Paraná, 09/10/2026):
-- UPDATE leads_mapeados l SET uf = c.uf FROM cidades c
--  WHERE l.uf IS NULL AND lower(l.cidade) = lower(c.nome) AND c.uf = 'PR';
