-- RPC de upsert para os pedidos de venda (grão pedido+item) e para as parcelas.
-- Rodar no SQL Editor do Supabase (uma vez, no projeto). Funciona para qualquer schema
-- de tenant através de p_schema_name.

CREATE OR REPLACE FUNCTION processar_carga_pedidos_vendas(
    p_data_json JSONB,
    p_schema_name TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    IF p_data_json IS NULL OR jsonb_array_length(p_data_json) = 0 THEN
        RETURN;
    END IF;

    IF p_schema_name IS NULL OR p_schema_name = '' THEN
        RAISE EXCEPTION 'Schema name é obrigatório';
    END IF;

    v_sql := format('
        INSERT INTO %I.pedidos_vendas (
            id_pedido, id_item,
            numero, numero_loja, data, data_saida, data_prevista, total_produtos, total,
            id_contato, nome_contato, tipo_pessoa_contato, documento_contato,
            id_situacao, valor_situacao,
            id_loja, id_vendedor, id_categoria,
            desconto_valor, desconto_unidade, outras_despesas,
            numero_pedido_compra, observacoes, observacoes_internas,
            frete_por_conta, valor_frete, quantidade_volumes, peso_bruto, prazo_entrega,
            codigo_item, descricao_item, descricao_detalhada_item, unidade_item,
            quantidade_item, valor_unitario_item, desconto_item_percentual, id_produto,
            data_extracao
        )
        SELECT
            (item->>''id_pedido'')::BIGINT,
            (item->>''id_item'')::BIGINT,
            (item->>''numero'')::INTEGER,
            item->>''numero_loja'',
            (item->>''data'')::DATE,
            (item->>''data_saida'')::DATE,
            (item->>''data_prevista'')::DATE,
            (item->>''total_produtos'')::DECIMAL,
            (item->>''total'')::DECIMAL,
            (item->>''id_contato'')::BIGINT,
            item->>''nome_contato'',
            item->>''tipo_pessoa_contato'',
            item->>''documento_contato'',
            (item->>''id_situacao'')::INTEGER,
            (item->>''valor_situacao'')::INTEGER,
            (item->>''id_loja'')::BIGINT,
            (item->>''id_vendedor'')::BIGINT,
            (item->>''id_categoria'')::BIGINT,
            (item->>''desconto_valor'')::DECIMAL,
            item->>''desconto_unidade'',
            (item->>''outras_despesas'')::DECIMAL,
            item->>''numero_pedido_compra'',
            item->>''observacoes'',
            item->>''observacoes_internas'',
            (item->>''frete_por_conta'')::SMALLINT,
            (item->>''valor_frete'')::DECIMAL,
            (item->>''quantidade_volumes'')::INTEGER,
            (item->>''peso_bruto'')::DECIMAL,
            (item->>''prazo_entrega'')::INTEGER,
            item->>''codigo_item'',
            item->>''descricao_item'',
            item->>''descricao_detalhada_item'',
            item->>''unidade_item'',
            (item->>''quantidade_item'')::DECIMAL,
            (item->>''valor_unitario_item'')::DECIMAL,
            (item->>''desconto_item_percentual'')::DECIMAL,
            (item->>''id_produto'')::BIGINT,
            (item->>''data_extracao'')::DATE
        FROM jsonb_array_elements($1) AS item
        ON CONFLICT (id_pedido, id_item)
        DO UPDATE SET
            numero = EXCLUDED.numero,
            numero_loja = EXCLUDED.numero_loja,
            data = EXCLUDED.data,
            data_saida = EXCLUDED.data_saida,
            data_prevista = EXCLUDED.data_prevista,
            total_produtos = EXCLUDED.total_produtos,
            total = EXCLUDED.total,
            id_contato = EXCLUDED.id_contato,
            nome_contato = EXCLUDED.nome_contato,
            tipo_pessoa_contato = EXCLUDED.tipo_pessoa_contato,
            documento_contato = EXCLUDED.documento_contato,
            id_situacao = EXCLUDED.id_situacao,
            valor_situacao = EXCLUDED.valor_situacao,
            id_loja = EXCLUDED.id_loja,
            id_vendedor = EXCLUDED.id_vendedor,
            id_categoria = EXCLUDED.id_categoria,
            desconto_valor = EXCLUDED.desconto_valor,
            desconto_unidade = EXCLUDED.desconto_unidade,
            outras_despesas = EXCLUDED.outras_despesas,
            numero_pedido_compra = EXCLUDED.numero_pedido_compra,
            observacoes = EXCLUDED.observacoes,
            observacoes_internas = EXCLUDED.observacoes_internas,
            frete_por_conta = EXCLUDED.frete_por_conta,
            valor_frete = EXCLUDED.valor_frete,
            quantidade_volumes = EXCLUDED.quantidade_volumes,
            peso_bruto = EXCLUDED.peso_bruto,
            prazo_entrega = EXCLUDED.prazo_entrega,
            codigo_item = EXCLUDED.codigo_item,
            descricao_item = EXCLUDED.descricao_item,
            descricao_detalhada_item = EXCLUDED.descricao_detalhada_item,
            unidade_item = EXCLUDED.unidade_item,
            quantidade_item = EXCLUDED.quantidade_item,
            valor_unitario_item = EXCLUDED.valor_unitario_item,
            desconto_item_percentual = EXCLUDED.desconto_item_percentual,
            id_produto = EXCLUDED.id_produto,
            data_extracao = EXCLUDED.data_extracao
    ', p_schema_name);

    EXECUTE v_sql USING p_data_json;
END;
$$;

GRANT EXECUTE ON FUNCTION processar_carga_pedidos_vendas(JSONB, TEXT) TO service_role;


CREATE OR REPLACE FUNCTION processar_carga_pedidos_vendas_parcelas(
    p_data_json JSONB,
    p_schema_name TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    IF p_data_json IS NULL OR jsonb_array_length(p_data_json) = 0 THEN
        RETURN;
    END IF;

    IF p_schema_name IS NULL OR p_schema_name = '' THEN
        RAISE EXCEPTION 'Schema name é obrigatório';
    END IF;

    v_sql := format('
        INSERT INTO %I.pedidos_vendas_parcelas (
            id_pedido, id_parcela, data_vencimento, valor, observacoes,
            id_forma_pagamento, data_extracao
        )
        SELECT
            (item->>''id_pedido'')::BIGINT,
            (item->>''id_parcela'')::BIGINT,
            (item->>''data_vencimento'')::DATE,
            (item->>''valor'')::DECIMAL,
            item->>''observacoes'',
            (item->>''id_forma_pagamento'')::BIGINT,
            (item->>''data_extracao'')::DATE
        FROM jsonb_array_elements($1) AS item
        ON CONFLICT (id_pedido, id_parcela)
        DO UPDATE SET
            data_vencimento = EXCLUDED.data_vencimento,
            valor = EXCLUDED.valor,
            observacoes = EXCLUDED.observacoes,
            id_forma_pagamento = EXCLUDED.id_forma_pagamento,
            data_extracao = EXCLUDED.data_extracao
    ', p_schema_name);

    EXECUTE v_sql USING p_data_json;
END;
$$;

GRANT EXECUTE ON FUNCTION processar_carga_pedidos_vendas_parcelas(JSONB, TEXT) TO service_role;
