-- Upserts de carga do ETL da Shopee. Só service_role executa (chave do ETL).

CREATE OR REPLACE FUNCTION processar_carga_shopee_pedidos(p_data_json JSONB, p_schema_name TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_data_json IS NULL OR jsonb_array_length(p_data_json) = 0 THEN RETURN; END IF;
    IF p_schema_name IS NULL OR p_schema_name = '' THEN RAISE EXCEPTION 'Schema name é obrigatório'; END IF;

    EXECUTE format('
        INSERT INTO %I.shopee_pedidos (
            shop_id, order_sn, id_canal, status, motivo_cancelamento, criado_em, pago_em, atualizado_em, enviar_ate,
            total, moeda, forma_pagamento, frete_real, frete_estimado, transportadora,
            comprador_id, comprador_usuario, data_extracao
        )
        SELECT
            (i->>''shop_id'')::BIGINT, i->>''order_sn'', (i->>''id_canal'')::UUID, i->>''status'', i->>''motivo_cancelamento'',
            (i->>''criado_em'')::TIMESTAMPTZ, (i->>''pago_em'')::TIMESTAMPTZ, (i->>''atualizado_em'')::TIMESTAMPTZ,
            (i->>''enviar_ate'')::TIMESTAMPTZ, (i->>''total'')::DECIMAL, i->>''moeda'', i->>''forma_pagamento'',
            (i->>''frete_real'')::DECIMAL, (i->>''frete_estimado'')::DECIMAL, i->>''transportadora'',
            (i->>''comprador_id'')::BIGINT, i->>''comprador_usuario'', (i->>''data_extracao'')::DATE
        FROM jsonb_array_elements($1) AS i
        ON CONFLICT (shop_id, order_sn) DO UPDATE SET
            id_canal = EXCLUDED.id_canal, status = EXCLUDED.status, motivo_cancelamento = EXCLUDED.motivo_cancelamento,
            criado_em = EXCLUDED.criado_em, pago_em = EXCLUDED.pago_em, atualizado_em = EXCLUDED.atualizado_em,
            enviar_ate = EXCLUDED.enviar_ate, total = EXCLUDED.total, moeda = EXCLUDED.moeda,
            forma_pagamento = EXCLUDED.forma_pagamento, frete_real = EXCLUDED.frete_real,
            frete_estimado = EXCLUDED.frete_estimado, transportadora = EXCLUDED.transportadora,
            comprador_id = EXCLUDED.comprador_id, comprador_usuario = EXCLUDED.comprador_usuario,
            data_extracao = EXCLUDED.data_extracao
    ', p_schema_name) USING p_data_json;
END;
$$;

CREATE OR REPLACE FUNCTION processar_carga_shopee_pedidos_itens(p_data_json JSONB, p_schema_name TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_data_json IS NULL OR jsonb_array_length(p_data_json) = 0 THEN RETURN; END IF;
    IF p_schema_name IS NULL OR p_schema_name = '' THEN RAISE EXCEPTION 'Schema name é obrigatório'; END IF;

    EXECUTE format('
        INSERT INTO %I.shopee_pedidos_itens (
            shop_id, order_sn, seq, item_id, model_id, sku, titulo, variacao, quantidade, preco, preco_cheio, data_extracao
        )
        SELECT
            (i->>''shop_id'')::BIGINT, i->>''order_sn'', (i->>''seq'')::INTEGER, (i->>''item_id'')::BIGINT,
            (i->>''model_id'')::BIGINT, i->>''sku'', i->>''titulo'', i->>''variacao'', (i->>''quantidade'')::DECIMAL,
            (i->>''preco'')::DECIMAL, (i->>''preco_cheio'')::DECIMAL, (i->>''data_extracao'')::DATE
        FROM jsonb_array_elements($1) AS i
        ON CONFLICT (shop_id, order_sn, seq) DO UPDATE SET
            item_id = EXCLUDED.item_id, model_id = EXCLUDED.model_id, sku = EXCLUDED.sku, titulo = EXCLUDED.titulo,
            variacao = EXCLUDED.variacao, quantidade = EXCLUDED.quantidade, preco = EXCLUDED.preco,
            preco_cheio = EXCLUDED.preco_cheio, data_extracao = EXCLUDED.data_extracao
    ', p_schema_name) USING p_data_json;
END;
$$;

REVOKE ALL ON FUNCTION processar_carga_shopee_pedidos(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION processar_carga_shopee_pedidos_itens(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION processar_carga_shopee_pedidos(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION processar_carga_shopee_pedidos_itens(JSONB, TEXT) TO service_role;
