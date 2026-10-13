-- Lote de vínculos produto x loja do Bling (campo "ID na loja"): candidatos e auditoria. Só service_role.
-- Regra: SKU do Bling manda (pareia produto e variante); preços e cadastro NUNCA mudam; só o ID na loja é gravado.
-- Execute substituindo "barbers" pelo schema do cliente, se for reusar para outro tenant.

CREATE TABLE IF NOT EXISTS barbers.vinculos_lojas_alteracoes (
    id                  BIGSERIAL PRIMARY KEY,
    id_produto_bling    BIGINT NOT NULL,
    id_loja             BIGINT NOT NULL,
    acao                VARCHAR(10) NOT NULL,      -- 'criar' | 'corrigir'
    codigo_anterior     VARCHAR(200),
    codigo_novo         VARCHAR(200),
    preco               DECIMAL(15,2),
    preco_promocional   DECIMAL(15,2),
    id_vinculo          BIGINT,
    resultado           VARCHAR(10) NOT NULL,      -- 'sucesso' | 'erro' | 'pulado'
    motivo              TEXT,                      -- erro do Bling ou motivo do pulo
    executado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vinculos_lojas_alt_produto ON barbers.vinculos_lojas_alteracoes (id_produto_bling, id_loja);
ALTER TABLE barbers.vinculos_lojas_alteracoes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION registrar_vinculos_lojas_alteracoes(p_data_json JSONB, p_schema_name TEXT)
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
        INSERT INTO %I.vinculos_lojas_alteracoes
            (id_produto_bling, id_loja, acao, codigo_anterior, codigo_novo, preco, preco_promocional, id_vinculo, resultado, motivo)
        SELECT (i->>''id_produto_bling'')::BIGINT, (i->>''id_loja'')::BIGINT, i->>''acao'', i->>''codigo_anterior'', i->>''codigo_novo'',
               (i->>''preco'')::DECIMAL, (i->>''preco_promocional'')::DECIMAL, (i->>''id_vinculo'')::BIGINT, i->>''resultado'', i->>''motivo''
        FROM jsonb_array_elements($1) AS i
    ', p_schema_name) USING p_data_json;
END;
$$;

-- Candidatos a gravar: produto ATIVO do Bling com SKU idêntico (normalizado) ao de uma variante da Nuvemshop, SEM vínculo na loja
-- ('criar') ou com ID 0/inexistente na Nuvemshop ('corrigir'), que ainda não tiveram sucesso na auditoria, e que NÃO caem nos casos
-- que pedem decisão: produto da Nuvemshop com várias variantes, estoque sem controle na loja, saldo negativo no Bling, item que a
-- loja ZERARIA (loja com estoque, Bling em zero) ou REABRIRIA (loja em zero, Bling com saldo).
CREATE OR REPLACE FUNCTION obter_vinculos_a_gravar(p_schema_name TEXT, p_id_loja BIGINT DEFAULT 206304549, p_offset INTEGER DEFAULT 0, p_limite INTEGER DEFAULT 1000)
RETURNS TABLE(
    id_produto_bling BIGINT, codigo_bling TEXT, store_id BIGINT, id_produto_ns BIGINT, id_variante BIGINT, sku_ns TEXT,
    preco_ns NUMERIC, promo_ns NUMERIC, estoque_ns NUMERIC, saldo_bling NUMERIC,
    acao TEXT, id_vinculo BIGINT, codigo_vinculo_atual TEXT
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
        ns_ids AS (SELECT DISTINCT id_produto::TEXT AS id FROM %1$I.nuvemshop_produtos),
        multi AS (SELECT id_produto FROM %1$I.nuvemshop_produtos GROUP BY 1 HAVING count(*) > 1),
        x AS (
            SELECT p.id_produto_bling, p.codigo_bling, p.store_id, p.id_produto_ns, p.id_variante, p.sku_ns, p.estoque_ns,
                   n.preco AS preco_ns, n.preco_promocional AS promo_ns, s.saldo_virtual, l.id_vinculo, l.codigo AS codigo_vinculo,
                   CASE WHEN l.id_produto IS NULL THEN ''criar''
                        WHEN l.codigo = p.id_produto_ns::TEXT THEN ''ok''
                        WHEN l.codigo IN (''0'', '''') OR l.codigo IS NULL THEN ''corrigir''
                        WHEN NOT EXISTS (SELECT 1 FROM ns_ids i WHERE i.id = l.codigo) THEN ''corrigir''
                        ELSE ''outro_produto'' END AS acao
            FROM par p
            JOIN %1$I.nuvemshop_produtos n ON n.id_variante = p.id_variante
            JOIN %1$I.estoque_saldos_bling s ON s.id_produto = p.id_produto_bling
            LEFT JOIN %1$I.produtos_lojas l ON l.id_produto = p.id_produto_bling AND l.id_loja = $1
            WHERE NOT EXISTS (SELECT 1 FROM %1$I.vinculos_lojas_alteracoes a
                              WHERE a.id_produto_bling = p.id_produto_bling AND a.id_loja = $1 AND a.resultado = ''sucesso'')
        )
        SELECT x.id_produto_bling, x.codigo_bling::TEXT, x.store_id, x.id_produto_ns, x.id_variante, x.sku_ns::TEXT,
               x.preco_ns::NUMERIC, x.promo_ns::NUMERIC, x.estoque_ns::NUMERIC, x.saldo_virtual::NUMERIC,
               x.acao, x.id_vinculo, x.codigo_vinculo::TEXT
        FROM x
        WHERE x.acao IN (''criar'', ''corrigir'')
          AND NOT EXISTS (SELECT 1 FROM multi m WHERE m.id_produto = x.id_produto_ns)
          AND x.estoque_ns IS NOT NULL
          AND x.saldo_virtual >= 0
          AND NOT (x.estoque_ns > 0 AND x.saldo_virtual = 0)
          AND NOT (x.estoque_ns = 0 AND x.saldo_virtual > 0)
        ORDER BY x.id_produto_bling
        OFFSET %3$L LIMIT %4$L
    ', p_schema_name, public.vinculo_sku_nuvemshop_sql(p_schema_name), GREATEST(p_offset, 0), GREATEST(LEAST(p_limite, 1000), 1))
    USING p_id_loja;
END;
$$;

REVOKE ALL ON FUNCTION registrar_vinculos_lojas_alteracoes(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION obter_vinculos_a_gravar(TEXT, BIGINT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION registrar_vinculos_lojas_alteracoes(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION obter_vinculos_a_gravar(TEXT, BIGINT, INTEGER, INTEGER) TO service_role;
