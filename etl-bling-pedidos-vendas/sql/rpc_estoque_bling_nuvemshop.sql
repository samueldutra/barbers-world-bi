-- Sincronização de estoque Bling -> Nuvemshop (o saldo do Bling é a fonte da verdade).
-- 1) barbers.estoque_saldos_bling: saldo de cada produto ativo no Bling (lido de GET /estoques/saldos).
-- 2) obter_pares_sku_estoque(): pares variante da Nuvemshop x produto do Bling por SKU idêntico (normalizado) + estoque atual
--    da variante, usados pelo script sync-estoque-bling-nuvemshop.py. Só service_role.
-- Execute substituindo "barbers" pelo schema do cliente, se for reusar para outro tenant.

CREATE TABLE IF NOT EXISTS barbers.estoque_saldos_bling (
    id_produto      BIGINT PRIMARY KEY,
    saldo_virtual   DECIMAL(15,3) NOT NULL,   -- saldoVirtualTotal (disponível: físico menos reservas)
    saldo_fisico    DECIMAL(15,3) NOT NULL,   -- saldoFisicoTotal
    atualizado_em   TIMESTAMPTZ NOT NULL
);
ALTER TABLE barbers.estoque_saldos_bling ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION processar_carga_estoque_saldos_bling(p_data_json JSONB, p_schema_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_data_json IS NULL OR jsonb_array_length(p_data_json) = 0 THEN
        RETURN;
    END IF;
    IF p_schema_name IS NULL OR p_schema_name = '' THEN
        RAISE EXCEPTION 'Schema name é obrigatório';
    END IF;
    EXECUTE format('
        INSERT INTO %I.estoque_saldos_bling (id_produto, saldo_virtual, saldo_fisico, atualizado_em)
        SELECT (i->>''id_produto'')::BIGINT, (i->>''saldo_virtual'')::DECIMAL, (i->>''saldo_fisico'')::DECIMAL,
               (i->>''atualizado_em'')::TIMESTAMPTZ
        FROM jsonb_array_elements($1) AS i
        ON CONFLICT (id_produto) DO UPDATE SET
            saldo_virtual = EXCLUDED.saldo_virtual, saldo_fisico = EXCLUDED.saldo_fisico, atualizado_em = EXCLUDED.atualizado_em
    ', p_schema_name) USING p_data_json;
END;
$$;

DROP FUNCTION IF EXISTS obter_pares_sku_estoque(TEXT);
-- Paginada: o Supabase corta RPC em 1000 linhas.
CREATE OR REPLACE FUNCTION obter_pares_sku_estoque(p_schema_name TEXT, p_offset INTEGER DEFAULT 0, p_limite INTEGER DEFAULT 1000)
RETURNS TABLE(
    store_id BIGINT, id_produto_ns BIGINT, id_variante BIGINT, sku_ns TEXT, nome_ns TEXT, publicado BOOLEAN, estoque_ns NUMERIC,
    id_produto_bling BIGINT, codigo_bling TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT t.store_id, t.id_produto_ns, t.id_variante, t.sku_ns, t.nome_ns, t.publicado, t.estoque_ns,
               t.id_produto_bling, t.codigo_bling
        FROM (%s) t
        WHERE t.visao = ''nuvemshop'' AND t.status IN (''vinculado'', ''vinculado_ajustar'')
        ORDER BY t.id_variante
        OFFSET %L LIMIT %L
    ', public.vinculo_sku_nuvemshop_sql(p_schema_name), GREATEST(p_offset, 0), GREATEST(LEAST(p_limite, 1000), 1));
END;
$$;

REVOKE ALL ON FUNCTION processar_carga_estoque_saldos_bling(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION obter_pares_sku_estoque(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION processar_carga_estoque_saldos_bling(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION obter_pares_sku_estoque(TEXT, INTEGER, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- LOTE: estoque da Nuvemshop = saldo virtual do Bling (negativo vira 0), nas variantes pareadas por SKU idêntico.
-- Auditoria de cada gravação + lista de candidatos (ordem: ajustes comuns, zerar, reabrir, saldo negativo, sem controle).
CREATE TABLE IF NOT EXISTS barbers.estoque_nuvemshop_alteracoes (
    id                BIGSERIAL PRIMARY KEY,
    id_variante       BIGINT NOT NULL,
    id_produto_bling  BIGINT NOT NULL,
    sku               VARCHAR(100),
    caso              VARCHAR(20),               -- ajuste | zerar | reabrir | saldo_negativo | sem_controle
    estoque_anterior  DECIMAL(15,3),             -- NULL = não controlado
    estoque_novo      DECIMAL(15,3),
    resultado         VARCHAR(10) NOT NULL,      -- sucesso | pulado | erro
    motivo            TEXT,
    executado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_estoque_ns_alt_variante ON barbers.estoque_nuvemshop_alteracoes (id_variante, executado_em DESC);
ALTER TABLE barbers.estoque_nuvemshop_alteracoes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION registrar_estoque_nuvemshop_alteracoes(p_data_json JSONB, p_schema_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_data_json IS NULL OR jsonb_array_length(p_data_json) = 0 THEN
        RETURN;
    END IF;
    EXECUTE format('
        INSERT INTO %I.estoque_nuvemshop_alteracoes
            (id_variante, id_produto_bling, sku, caso, estoque_anterior, estoque_novo, resultado, motivo)
        SELECT (i->>''id_variante'')::BIGINT, (i->>''id_produto_bling'')::BIGINT, i->>''sku'', i->>''caso'',
               (i->>''estoque_anterior'')::DECIMAL, (i->>''estoque_novo'')::DECIMAL, i->>''resultado'', i->>''motivo''
        FROM jsonb_array_elements($1) AS i
    ', p_schema_name) USING p_data_json;
END;
$$;

CREATE OR REPLACE FUNCTION obter_estoques_a_gravar(p_schema_name TEXT, p_offset INTEGER DEFAULT 0, p_limite INTEGER DEFAULT 1000)
RETURNS TABLE(
    store_id BIGINT, id_produto_ns BIGINT, id_variante BIGINT, sku_ns TEXT, id_produto_bling BIGINT, codigo_bling TEXT,
    estoque_ns NUMERIC, saldo_bling NUMERIC, estoque_alvo NUMERIC, caso TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        WITH par AS (
            SELECT t.* FROM (%2$s) t WHERE t.visao = ''nuvemshop'' AND t.status IN (''vinculado'', ''vinculado_ajustar'')
        ),
        x AS (
            SELECT p.store_id, p.id_produto_ns, p.id_variante, p.sku_ns, p.id_produto_bling, p.codigo_bling, p.estoque_ns,
                   s.saldo_virtual AS saldo_bling, GREATEST(s.saldo_virtual, 0) AS estoque_alvo,
                   CASE WHEN p.estoque_ns IS NULL THEN ''sem_controle''
                        WHEN s.saldo_virtual < 0 THEN ''saldo_negativo''
                        WHEN p.estoque_ns > 0 AND s.saldo_virtual = 0 THEN ''zerar''
                        WHEN p.estoque_ns = 0 AND s.saldo_virtual > 0 THEN ''reabrir''
                        ELSE ''ajuste'' END AS caso
            FROM par p JOIN %1$I.estoque_saldos_bling s ON s.id_produto = p.id_produto_bling
        )
        SELECT x.store_id, x.id_produto_ns, x.id_variante, x.sku_ns::TEXT, x.id_produto_bling, x.codigo_bling::TEXT,
               x.estoque_ns::NUMERIC, x.saldo_bling::NUMERIC, x.estoque_alvo::NUMERIC, x.caso
        FROM x
        WHERE x.estoque_ns IS NULL OR x.estoque_ns <> x.estoque_alvo
        ORDER BY CASE x.caso WHEN ''ajuste'' THEN 1 WHEN ''zerar'' THEN 2 WHEN ''reabrir'' THEN 3 WHEN ''saldo_negativo'' THEN 4 ELSE 5 END, x.id_variante
        OFFSET %3$L LIMIT %4$L
    ', p_schema_name, public.vinculo_sku_nuvemshop_sql(p_schema_name), GREATEST(p_offset, 0), GREATEST(LEAST(p_limite, 1000), 1));
END;
$$;

REVOKE ALL ON FUNCTION registrar_estoque_nuvemshop_alteracoes(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION obter_estoques_a_gravar(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION registrar_estoque_nuvemshop_alteracoes(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION obter_estoques_a_gravar(TEXT, INTEGER, INTEGER) TO service_role;
