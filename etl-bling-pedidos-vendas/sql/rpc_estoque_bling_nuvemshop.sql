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

CREATE OR REPLACE FUNCTION obter_pares_sku_estoque(p_schema_name TEXT)
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
    ', public.vinculo_sku_nuvemshop_sql(p_schema_name));
END;
$$;

REVOKE ALL ON FUNCTION processar_carga_estoque_saldos_bling(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION obter_pares_sku_estoque(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION processar_carga_estoque_saldos_bling(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION obter_pares_sku_estoque(TEXT) TO service_role;
