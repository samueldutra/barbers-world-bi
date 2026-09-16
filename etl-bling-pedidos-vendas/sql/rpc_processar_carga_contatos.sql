CREATE OR REPLACE FUNCTION processar_carga_contatos(
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
        INSERT INTO %I.contatos (
            id_contato, nome, fantasia, tipo_pessoa, documento, situacao,
            telefone, celular, email, data_nascimento,
            endereco, numero_endereco, bairro, municipio, uf, cep,
            data_sincronizacao
        )
        SELECT
            (item->>''id_contato'')::BIGINT,
            item->>''nome'',
            item->>''fantasia'',
            item->>''tipo_pessoa'',
            item->>''documento'',
            item->>''situacao'',
            item->>''telefone'',
            item->>''celular'',
            item->>''email'',
            (item->>''data_nascimento'')::DATE,
            item->>''endereco'',
            item->>''numero_endereco'',
            item->>''bairro'',
            item->>''municipio'',
            item->>''uf'',
            item->>''cep'',
            (item->>''data_sincronizacao'')::TIMESTAMPTZ
        FROM jsonb_array_elements($1) AS item
        ON CONFLICT (id_contato)
        DO UPDATE SET
            nome = EXCLUDED.nome,
            fantasia = EXCLUDED.fantasia,
            tipo_pessoa = EXCLUDED.tipo_pessoa,
            documento = EXCLUDED.documento,
            situacao = EXCLUDED.situacao,
            telefone = EXCLUDED.telefone,
            celular = EXCLUDED.celular,
            email = EXCLUDED.email,
            data_nascimento = EXCLUDED.data_nascimento,
            endereco = EXCLUDED.endereco,
            numero_endereco = EXCLUDED.numero_endereco,
            bairro = EXCLUDED.bairro,
            municipio = EXCLUDED.municipio,
            uf = EXCLUDED.uf,
            cep = EXCLUDED.cep,
            data_sincronizacao = EXCLUDED.data_sincronizacao
    ', p_schema_name);

    EXECUTE v_sql USING p_data_json;
END;
$$;

GRANT EXECUTE ON FUNCTION processar_carga_contatos(JSONB, TEXT) TO service_role;


-- Retorna os id_contato que aparecem em pedidos_vendas mas ainda não têm linha em
-- contatos (ou têm uma sincronização velha) — usado pelo script de sync pra saber
-- quais buscar na API, sem precisar re-baixar cliente que não mudou.
CREATE OR REPLACE FUNCTION obter_contatos_pendentes_sync(
    p_schema_name TEXT,
    p_dias_revalidar INTEGER DEFAULT 30,
    p_limite INTEGER DEFAULT 500
)
RETURNS TABLE(id_contato BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT DISTINCT pv.id_contato
        FROM %I.pedidos_vendas pv
        LEFT JOIN %I.contatos c ON c.id_contato = pv.id_contato
        WHERE pv.id_contato IS NOT NULL
          AND pv.id_contato <> 0
          AND (c.id_contato IS NULL OR c.data_sincronizacao < now() - (%L || '' days'')::INTERVAL)
        LIMIT %L
    ', p_schema_name, p_schema_name, p_dias_revalidar, p_limite);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION obter_contatos_pendentes_sync(TEXT, INTEGER, INTEGER) TO service_role;
