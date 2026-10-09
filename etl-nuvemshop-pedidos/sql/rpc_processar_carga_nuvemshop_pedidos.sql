-- Upserts de carga do ETL da Nuvemshop. Só service_role executa (chave do ETL).

CREATE OR REPLACE FUNCTION processar_carga_nuvemshop_pedidos(
    p_data_json JSONB,
    p_schema_name TEXT
)
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
        INSERT INTO %I.nuvemshop_pedidos (
            store_id, id_pedido, id_canal, numero, status, status_pagamento, status_envio, motivo_cancelamento,
            criado_em, atualizado_em, pago_em, enviado_em, fechado_em, cancelado_em,
            subtotal, desconto, desconto_cupom, desconto_gateway, desconto_promocional,
            frete_cliente, frete_loja, total, moeda,
            gateway, forma_pagamento, bandeira_cartao, parcelas, cupons, opcao_envio, loja_virtual,
            cliente_id, cliente_nome, cliente_email, cliente_telefone, cliente_documento,
            entrega_cidade, entrega_uf, entrega_cep, observacao_cliente, observacao_loja, data_extracao
        )
        SELECT
            (i->>''store_id'')::BIGINT, (i->>''id_pedido'')::BIGINT, (i->>''id_canal'')::UUID, (i->>''numero'')::INTEGER,
            i->>''status'', i->>''status_pagamento'', i->>''status_envio'', i->>''motivo_cancelamento'',
            (i->>''criado_em'')::TIMESTAMPTZ, (i->>''atualizado_em'')::TIMESTAMPTZ, (i->>''pago_em'')::TIMESTAMPTZ,
            (i->>''enviado_em'')::TIMESTAMPTZ, (i->>''fechado_em'')::TIMESTAMPTZ, (i->>''cancelado_em'')::TIMESTAMPTZ,
            (i->>''subtotal'')::DECIMAL, (i->>''desconto'')::DECIMAL, (i->>''desconto_cupom'')::DECIMAL,
            (i->>''desconto_gateway'')::DECIMAL, (i->>''desconto_promocional'')::DECIMAL,
            (i->>''frete_cliente'')::DECIMAL, (i->>''frete_loja'')::DECIMAL, (i->>''total'')::DECIMAL, i->>''moeda'',
            i->>''gateway'', i->>''forma_pagamento'', i->>''bandeira_cartao'', (i->>''parcelas'')::INTEGER,
            i->>''cupons'', i->>''opcao_envio'', i->>''loja_virtual'',
            (i->>''cliente_id'')::BIGINT, i->>''cliente_nome'', i->>''cliente_email'', i->>''cliente_telefone'',
            i->>''cliente_documento'', i->>''entrega_cidade'', i->>''entrega_uf'', i->>''entrega_cep'',
            i->>''observacao_cliente'', i->>''observacao_loja'', (i->>''data_extracao'')::DATE
        FROM jsonb_array_elements($1) AS i
        ON CONFLICT (store_id, id_pedido) DO UPDATE SET
            id_canal = EXCLUDED.id_canal, numero = EXCLUDED.numero, status = EXCLUDED.status,
            status_pagamento = EXCLUDED.status_pagamento, status_envio = EXCLUDED.status_envio,
            motivo_cancelamento = EXCLUDED.motivo_cancelamento,
            criado_em = EXCLUDED.criado_em, atualizado_em = EXCLUDED.atualizado_em, pago_em = EXCLUDED.pago_em,
            enviado_em = EXCLUDED.enviado_em, fechado_em = EXCLUDED.fechado_em, cancelado_em = EXCLUDED.cancelado_em,
            subtotal = EXCLUDED.subtotal, desconto = EXCLUDED.desconto, desconto_cupom = EXCLUDED.desconto_cupom,
            desconto_gateway = EXCLUDED.desconto_gateway, desconto_promocional = EXCLUDED.desconto_promocional,
            frete_cliente = EXCLUDED.frete_cliente, frete_loja = EXCLUDED.frete_loja, total = EXCLUDED.total,
            moeda = EXCLUDED.moeda, gateway = EXCLUDED.gateway, forma_pagamento = EXCLUDED.forma_pagamento,
            bandeira_cartao = EXCLUDED.bandeira_cartao, parcelas = EXCLUDED.parcelas, cupons = EXCLUDED.cupons,
            opcao_envio = EXCLUDED.opcao_envio, loja_virtual = EXCLUDED.loja_virtual,
            cliente_id = EXCLUDED.cliente_id, cliente_nome = EXCLUDED.cliente_nome,
            cliente_email = EXCLUDED.cliente_email, cliente_telefone = EXCLUDED.cliente_telefone,
            cliente_documento = EXCLUDED.cliente_documento, entrega_cidade = EXCLUDED.entrega_cidade,
            entrega_uf = EXCLUDED.entrega_uf, entrega_cep = EXCLUDED.entrega_cep,
            observacao_cliente = EXCLUDED.observacao_cliente, observacao_loja = EXCLUDED.observacao_loja,
            data_extracao = EXCLUDED.data_extracao
    ', p_schema_name) USING p_data_json;
END;
$$;

CREATE OR REPLACE FUNCTION processar_carga_nuvemshop_pedidos_itens(
    p_data_json JSONB,
    p_schema_name TEXT
)
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
        INSERT INTO %I.nuvemshop_pedidos_itens (
            store_id, id_pedido, id_item, id_produto, id_variante, sku, codigo_barras, nome,
            quantidade, preco, custo, peso, data_extracao
        )
        SELECT
            (i->>''store_id'')::BIGINT, (i->>''id_pedido'')::BIGINT, (i->>''id_item'')::BIGINT,
            (i->>''id_produto'')::BIGINT, (i->>''id_variante'')::BIGINT, i->>''sku'', i->>''codigo_barras'', i->>''nome'',
            (i->>''quantidade'')::DECIMAL, (i->>''preco'')::DECIMAL, (i->>''custo'')::DECIMAL, (i->>''peso'')::DECIMAL,
            (i->>''data_extracao'')::DATE
        FROM jsonb_array_elements($1) AS i
        ON CONFLICT (store_id, id_pedido, id_item) DO UPDATE SET
            id_produto = EXCLUDED.id_produto, id_variante = EXCLUDED.id_variante, sku = EXCLUDED.sku,
            codigo_barras = EXCLUDED.codigo_barras, nome = EXCLUDED.nome, quantidade = EXCLUDED.quantidade,
            preco = EXCLUDED.preco, custo = EXCLUDED.custo, peso = EXCLUDED.peso,
            data_extracao = EXCLUDED.data_extracao
    ', p_schema_name) USING p_data_json;
END;
$$;

REVOKE ALL ON FUNCTION processar_carga_nuvemshop_pedidos(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION processar_carga_nuvemshop_pedidos_itens(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION processar_carga_nuvemshop_pedidos(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION processar_carga_nuvemshop_pedidos_itens(JSONB, TEXT) TO service_role;
