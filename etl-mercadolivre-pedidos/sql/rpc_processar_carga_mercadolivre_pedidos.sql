-- Upserts de carga do ETL do Mercado Livre. Só service_role executa (chave do ETL).

CREATE OR REPLACE FUNCTION processar_carga_mercadolivre_pedidos(p_data_json JSONB, p_schema_name TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_data_json IS NULL OR jsonb_array_length(p_data_json) = 0 THEN RETURN; END IF;
    IF p_schema_name IS NULL OR p_schema_name = '' THEN RAISE EXCEPTION 'Schema name é obrigatório'; END IF;

    EXECUTE format('
        INSERT INTO %I.mercadolivre_pedidos (
            seller_id, id_pedido, id_canal, pack_id, status, status_detalhe, tags, motivo_cancelamento,
            criado_em, fechado_em, atualizado_em, total, total_pago, moeda, comissao, taxa_pagamento, frete_id,
            forma_pagamento, tipo_pagamento, parcelas, canal_origem, comprador_id, comprador_apelido, data_extracao
        )
        SELECT
            (i->>''seller_id'')::BIGINT, (i->>''id_pedido'')::BIGINT, (i->>''id_canal'')::UUID, (i->>''pack_id'')::BIGINT,
            i->>''status'', i->>''status_detalhe'', i->>''tags'', i->>''motivo_cancelamento'',
            (i->>''criado_em'')::TIMESTAMPTZ, (i->>''fechado_em'')::TIMESTAMPTZ, (i->>''atualizado_em'')::TIMESTAMPTZ,
            (i->>''total'')::DECIMAL, (i->>''total_pago'')::DECIMAL, i->>''moeda'',
            (i->>''comissao'')::DECIMAL, (i->>''taxa_pagamento'')::DECIMAL, (i->>''frete_id'')::BIGINT,
            i->>''forma_pagamento'', i->>''tipo_pagamento'', (i->>''parcelas'')::INTEGER, i->>''canal_origem'',
            (i->>''comprador_id'')::BIGINT, i->>''comprador_apelido'', (i->>''data_extracao'')::DATE
        FROM jsonb_array_elements($1) AS i
        ON CONFLICT (seller_id, id_pedido) DO UPDATE SET
            id_canal = EXCLUDED.id_canal, pack_id = EXCLUDED.pack_id, status = EXCLUDED.status,
            status_detalhe = EXCLUDED.status_detalhe, tags = EXCLUDED.tags,
            motivo_cancelamento = EXCLUDED.motivo_cancelamento, criado_em = EXCLUDED.criado_em,
            fechado_em = EXCLUDED.fechado_em, atualizado_em = EXCLUDED.atualizado_em, total = EXCLUDED.total,
            total_pago = EXCLUDED.total_pago, moeda = EXCLUDED.moeda, comissao = EXCLUDED.comissao,
            taxa_pagamento = EXCLUDED.taxa_pagamento, frete_id = EXCLUDED.frete_id,
            forma_pagamento = EXCLUDED.forma_pagamento, tipo_pagamento = EXCLUDED.tipo_pagamento,
            parcelas = EXCLUDED.parcelas, canal_origem = EXCLUDED.canal_origem, comprador_id = EXCLUDED.comprador_id,
            comprador_apelido = EXCLUDED.comprador_apelido, data_extracao = EXCLUDED.data_extracao
    ', p_schema_name) USING p_data_json;
END;
$$;

CREATE OR REPLACE FUNCTION processar_carga_mercadolivre_pedidos_itens(p_data_json JSONB, p_schema_name TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_data_json IS NULL OR jsonb_array_length(p_data_json) = 0 THEN RETURN; END IF;
    IF p_schema_name IS NULL OR p_schema_name = '' THEN RAISE EXCEPTION 'Schema name é obrigatório'; END IF;

    EXECUTE format('
        INSERT INTO %I.mercadolivre_pedidos_itens (
            seller_id, id_pedido, seq, id_anuncio, id_variacao, sku, titulo, categoria_id,
            quantidade, preco, preco_cheio, comissao_unit, tipo_anuncio, data_extracao
        )
        SELECT
            (i->>''seller_id'')::BIGINT, (i->>''id_pedido'')::BIGINT, (i->>''seq'')::INTEGER,
            i->>''id_anuncio'', (i->>''id_variacao'')::BIGINT, i->>''sku'', i->>''titulo'', i->>''categoria_id'',
            (i->>''quantidade'')::DECIMAL, (i->>''preco'')::DECIMAL, (i->>''preco_cheio'')::DECIMAL,
            (i->>''comissao_unit'')::DECIMAL, i->>''tipo_anuncio'', (i->>''data_extracao'')::DATE
        FROM jsonb_array_elements($1) AS i
        ON CONFLICT (seller_id, id_pedido, seq) DO UPDATE SET
            id_anuncio = EXCLUDED.id_anuncio, id_variacao = EXCLUDED.id_variacao, sku = EXCLUDED.sku,
            titulo = EXCLUDED.titulo, categoria_id = EXCLUDED.categoria_id, quantidade = EXCLUDED.quantidade,
            preco = EXCLUDED.preco, preco_cheio = EXCLUDED.preco_cheio, comissao_unit = EXCLUDED.comissao_unit,
            tipo_anuncio = EXCLUDED.tipo_anuncio, data_extracao = EXCLUDED.data_extracao
    ', p_schema_name) USING p_data_json;
END;
$$;

REVOKE ALL ON FUNCTION processar_carga_mercadolivre_pedidos(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION processar_carga_mercadolivre_pedidos_itens(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION processar_carga_mercadolivre_pedidos(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION processar_carga_mercadolivre_pedidos_itens(JSONB, TEXT) TO service_role;
