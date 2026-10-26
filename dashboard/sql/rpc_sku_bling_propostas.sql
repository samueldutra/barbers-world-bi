-- Módulo "Gerar SKU no Bling": produtos ativos do Bling SEM código (SKU) recebem um código proposto, aprovado
-- numa prévia, e aplicado pela rota /api/sku-bling/aplicar (PATCH /produtos/{id} só com o campo codigo).
--
-- As propostas ficam numa tabela (e não são recalculadas na hora): o código de cada produto não pode mudar
-- quando outros são aplicados (o desempate "TCP2" depende de quem já existe).
-- Regra da geração (seed_sku_bling_propostas.sql): iniciais das palavras do nome; palavras com número entram
-- inteiras; "DE/DA/DO/PARA/COM/E/EM/NA/NO/C" ignoradas; base com 1-2 letras vira 3 letras (1 palavra: 3 primeiras;
-- 2+ palavras: 1ª letra da 1ª + 2 primeiras da 2ª, ou 1ª + 1ª e última da 2ª se repetir); repetição ganha número.

CREATE TABLE IF NOT EXISTS barbers.sku_bling_propostas (
    id_produto        BIGINT PRIMARY KEY,           -- barbers.produtos.id_produto (= id no Bling)
    codigo_proposto   VARCHAR(60) NOT NULL,
    observacao        TEXT,
    status            VARCHAR(10) NOT NULL DEFAULT 'pendente',  -- pendente | aplicado | erro | excluido
    erro              TEXT,                         -- mensagem da última tentativa que falhou
    aplicado_em       TIMESTAMPTZ,
    usuario_id        UUID,
    usuario_email     TEXT,
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sku_bling_propostas_status_chk CHECK (status IN ('pendente', 'aplicado', 'erro', 'excluido'))
);

-- Dois produtos não podem receber o mesmo código (o Bling também recusa duplicado).
CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_bling_propostas_codigo
    ON barbers.sku_bling_propostas (upper(codigo_proposto)) WHERE status <> 'excluido';

-- Só acessada via RPC SECURITY DEFINER (schema barbers não é exposto no PostgREST).
ALTER TABLE barbers.sku_bling_propostas ENABLE ROW LEVEL SECURITY;

-- Listagem pra tela (paginada server-side, total_registros em cada linha).
CREATE OR REPLACE FUNCTION obter_propostas_sku_bling(
    p_schema_name TEXT,
    p_status TEXT DEFAULT 'pendente',   -- 'todos' | pendente | aplicado | erro | excluido
    p_busca TEXT DEFAULT NULL,          -- nome ou código proposto
    p_pagina INTEGER DEFAULT 1,
    p_tamanho_pagina INTEGER DEFAULT 50
)
RETURNS TABLE(
    id_produto BIGINT,
    nome TEXT,
    preco NUMERIC,
    codigo_atual TEXT,                  -- código hoje no BI (deve estar vazio nas pendentes)
    codigo_proposto TEXT,
    observacao TEXT,
    status TEXT,
    erro TEXT,
    aplicado_em TIMESTAMPTZ,
    com_vendas BOOLEAN,
    total_registros BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_busca TEXT;
    v_offset INTEGER;
BEGIN
    PERFORM public.assert_tenant_access(p_schema_name);
    v_busca := CASE WHEN p_busca IS NULL OR btrim(p_busca) = '' THEN NULL ELSE '%' || btrim(p_busca) || '%' END;
    v_offset := (GREATEST(p_pagina, 1) - 1) * GREATEST(p_tamanho_pagina, 1);

    RETURN QUERY EXECUTE format('
        SELECT pp.id_produto, p.nome::TEXT, p.preco::NUMERIC, p.codigo::TEXT, pp.codigo_proposto::TEXT,
               pp.observacao, pp.status::TEXT, pp.erro, pp.aplicado_em,
               EXISTS (SELECT 1 FROM %1$I.pedidos_vendas pv WHERE pv.id_produto = pp.id_produto),
               count(*) OVER()::BIGINT
        FROM %1$I.sku_bling_propostas pp
        LEFT JOIN %1$I.produtos p ON p.id_produto = pp.id_produto
        WHERE (%2$L = ''todos'' OR pp.status = %2$L)
          AND (%3$L::TEXT IS NULL OR p.nome ILIKE %3$L OR pp.codigo_proposto ILIKE %3$L)
        ORDER BY p.nome, pp.id_produto
        LIMIT %4$L OFFSET %5$L
    ', p_schema_name, p_status, v_busca, GREATEST(p_tamanho_pagina, 1), v_offset);
END;
$$;

CREATE OR REPLACE FUNCTION obter_resumo_propostas_sku_bling(p_schema_name TEXT)
RETURNS TABLE(status TEXT, quantidade BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_tenant_access(p_schema_name);
    RETURN QUERY EXECUTE format('SELECT status::TEXT, count(*)::BIGINT FROM %I.sku_bling_propostas GROUP BY status', p_schema_name);
END;
$$;

-- Antes de gravar no Bling: a proposta existe e está pendente/erro? o produto ainda está sem código no BI?
-- o código proposto já existe em outro produto ativo? Quantas aplicações já deram certo (trava do teste)?
CREATE OR REPLACE FUNCTION validar_proposta_sku_bling(p_schema_name TEXT, p_id_produto BIGINT)
RETURNS TABLE(existe BOOLEAN, status TEXT, codigo_proposto TEXT, nome TEXT, codigo_atual TEXT, situacao TEXT,
              qtd_outros_com_codigo INTEGER, aplicados INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_tenant_access(p_schema_name);
    RETURN QUERY EXECUTE format('
        SELECT pp.id_produto IS NOT NULL, pp.status::TEXT, pp.codigo_proposto::TEXT, p.nome::TEXT, p.codigo::TEXT, p.situacao::TEXT,
               (SELECT count(*) FROM %1$I.produtos o WHERE o.id_produto <> $1
                   AND public.normalizar_sku(o.codigo) = public.normalizar_sku(pp.codigo_proposto))::INTEGER,
               (SELECT count(*) FROM %1$I.sku_bling_propostas a WHERE a.status = ''aplicado'')::INTEGER
        FROM (SELECT $1::BIGINT AS id) q
        LEFT JOIN %1$I.sku_bling_propostas pp ON pp.id_produto = q.id
        LEFT JOIN %1$I.produtos p ON p.id_produto = q.id
    ', p_schema_name) USING p_id_produto;
END;
$$;

-- Depois de cada tentativa no Bling. Em sucesso grava o código também em produtos (sem esperar o próximo sync).
CREATE OR REPLACE FUNCTION registrar_aplicacao_sku_bling(
    p_schema_name TEXT,
    p_id_produto BIGINT,
    p_sucesso BOOLEAN,
    p_erro TEXT,
    p_usuario_id UUID,
    p_usuario_email TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_codigo TEXT;
BEGIN
    PERFORM public.assert_tenant_access(p_schema_name);
    EXECUTE format('
        UPDATE %I.sku_bling_propostas
        SET status = CASE WHEN $2 THEN ''aplicado'' ELSE ''erro'' END,
            erro = $3, aplicado_em = CASE WHEN $2 THEN now() ELSE aplicado_em END,
            usuario_id = $4, usuario_email = $5
        WHERE id_produto = $1
        RETURNING codigo_proposto
    ', p_schema_name) INTO v_codigo USING p_id_produto, p_sucesso, p_erro, p_usuario_id, p_usuario_email;

    IF p_sucesso AND v_codigo IS NOT NULL THEN
        EXECUTE format('UPDATE %I.produtos SET codigo = $2 WHERE id_produto = $1', p_schema_name)
        USING p_id_produto, v_codigo;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION obter_propostas_sku_bling(TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION obter_resumo_propostas_sku_bling(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION obter_propostas_sku_bling(TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION obter_resumo_propostas_sku_bling(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION validar_proposta_sku_bling(TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION registrar_aplicacao_sku_bling(TEXT, BIGINT, BOOLEAN, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION validar_proposta_sku_bling(TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION registrar_aplicacao_sku_bling(TEXT, BIGINT, BOOLEAN, TEXT, UUID, TEXT) TO service_role;
