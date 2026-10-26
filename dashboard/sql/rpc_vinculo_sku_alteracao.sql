-- Correção de vínculo pela tela "Vínculo de SKU": grava o SKU do Bling na variante da Nuvemshop
-- (PUT /products/{id}/variants/{id} — só o campo sku; preço e estoque NÃO são tocados).
-- Quem chama é a rota /api/vinculo-sku/alterar (service_role), depois de validar sessão e módulo.

-- Auditoria: quem mudou, de quê pra quê, e se a Nuvemshop aceitou (falha também é registrada).
CREATE TABLE IF NOT EXISTS barbers.nuvemshop_alteracoes_sku (
    id                BIGSERIAL PRIMARY KEY,
    store_id          BIGINT NOT NULL,
    id_produto_ns     BIGINT NOT NULL,
    id_variante       BIGINT NOT NULL,
    sku_anterior      VARCHAR(100),
    sku_novo          VARCHAR(100) NOT NULL,
    id_produto_bling  BIGINT,                 -- produto do Bling cujo código foi gravado
    origem            VARCHAR(20) NOT NULL,   -- 'sugestao' (sugerido pela tela) | 'manual' (digitado) | 'ajuste' (só espaço/maiúscula)
    sucesso           BOOLEAN NOT NULL,
    erro              TEXT,
    usuario_id        UUID,
    usuario_email     TEXT,
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nuvemshop_alteracoes_sku_variante
    ON barbers.nuvemshop_alteracoes_sku (store_id, id_variante, criado_em DESC);

-- Só acessada via RPC SECURITY DEFINER (schema barbers não é exposto no PostgREST).
ALTER TABLE barbers.nuvemshop_alteracoes_sku ENABLE ROW LEVEL SECURITY;

-- Antes de gravar na Nuvemshop: o SKU informado existe em exatamente 1 produto ATIVO do Bling? e já é
-- usado por OUTRA variante da Nuvemshop (criaria duplicidade)? Compara normalizado (espaço/maiúscula);
-- devolve o código exato do Bling, que é o que a rota grava.
CREATE OR REPLACE FUNCTION validar_sku_vinculo_nuvemshop(
    p_schema_name TEXT,
    p_sku TEXT,
    p_id_variante BIGINT
)
RETURNS TABLE(qtd_bling INTEGER, id_produto_bling BIGINT, codigo_bling TEXT, nome_bling TEXT, qtd_outras_variantes_ns INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_tenant_access(p_schema_name);
    RETURN QUERY EXECUTE format('
        SELECT
            (SELECT count(*) FROM %1$I.produtos p WHERE p.situacao = ''A'' AND public.normalizar_sku(p.codigo) = public.normalizar_sku($1))::INTEGER,
            (SELECT min(p.id_produto) FROM %1$I.produtos p WHERE p.situacao = ''A'' AND public.normalizar_sku(p.codigo) = public.normalizar_sku($1)),
            (SELECT min(p.codigo)::TEXT FROM %1$I.produtos p WHERE p.situacao = ''A'' AND public.normalizar_sku(p.codigo) = public.normalizar_sku($1)),
            (SELECT min(p.nome)::TEXT FROM %1$I.produtos p WHERE p.situacao = ''A'' AND public.normalizar_sku(p.codigo) = public.normalizar_sku($1)),
            (SELECT count(*) FROM %1$I.nuvemshop_produtos n WHERE public.normalizar_sku(n.sku) = public.normalizar_sku($1) AND n.id_variante <> $2)::INTEGER
    ', p_schema_name) USING p_sku, p_id_variante;
END;
$$;

-- Chamada pela rota depois de cada PUT na Nuvemshop (sucesso ou falha). Em sucesso já reflete o SKU novo em
-- nuvemshop_produtos (sem esperar o próximo ETL), então a tela mostra o novo status na hora.
CREATE OR REPLACE FUNCTION registrar_alteracao_sku_nuvemshop(
    p_schema_name TEXT,
    p_store_id BIGINT,
    p_id_produto_ns BIGINT,
    p_id_variante BIGINT,
    p_sku_anterior TEXT,
    p_sku_novo TEXT,
    p_id_produto_bling BIGINT,
    p_origem TEXT,
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
BEGIN
    PERFORM public.assert_tenant_access(p_schema_name);
    EXECUTE format('
        INSERT INTO %I.nuvemshop_alteracoes_sku
            (store_id, id_produto_ns, id_variante, sku_anterior, sku_novo, id_produto_bling, origem, sucesso, erro, usuario_id, usuario_email)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ', p_schema_name)
    USING p_store_id, p_id_produto_ns, p_id_variante, p_sku_anterior, p_sku_novo, p_id_produto_bling, p_origem,
          p_sucesso, p_erro, p_usuario_id, p_usuario_email;

    IF p_sucesso THEN
        EXECUTE format('
            UPDATE %I.nuvemshop_produtos SET sku = $4
            WHERE store_id = $1 AND id_produto = $2 AND id_variante = $3
        ', p_schema_name)
        USING p_store_id, p_id_produto_ns, p_id_variante, p_sku_novo;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION validar_sku_vinculo_nuvemshop(TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION registrar_alteracao_sku_nuvemshop(TEXT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION validar_sku_vinculo_nuvemshop(TEXT, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION registrar_alteracao_sku_nuvemshop(TEXT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, TEXT, UUID, TEXT) TO service_role;

-- Seletor de produto do Bling (tela Vínculo de SKU): pesquisa produtos ATIVOS com código, por palavras do nome
-- ou do código (sem acento/maiúscula; todas as palavras precisam aparecer). Sem busca, lista os de nome mais
-- parecido com p_referencia (o nome do produto na Nuvemshop). Devolve quantas variantes da Nuvemshop já usam o
-- código (qtd_variantes_ns > 0 = já vinculado: a tela não deixa escolher pra não duplicar SKU na loja).
CREATE OR REPLACE FUNCTION buscar_produtos_bling(
    p_schema_name TEXT,
    p_busca TEXT DEFAULT NULL,
    p_referencia TEXT DEFAULT NULL,
    p_limite INTEGER DEFAULT 30
)
RETURNS TABLE(id_produto BIGINT, codigo TEXT, nome TEXT, preco NUMERIC, formato TEXT, qtd_variantes_ns INTEGER, score NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_palavras TEXT[];
    v_chave TEXT;
BEGIN
    PERFORM public.assert_tenant_access(p_schema_name);
    v_palavras := COALESCE(regexp_split_to_array(public.normalizar_nome(p_busca), '\s+'), ARRAY[]::TEXT[]);
    v_chave := COALESCE(public.normalizar_nome(NULLIF(btrim(COALESCE(p_busca, '')), '')), public.normalizar_nome(p_referencia));

    RETURN QUERY EXECUTE format('
        SELECT p.id_produto, p.codigo::TEXT, p.nome::TEXT, p.preco::NUMERIC, p.formato::TEXT,
               (SELECT count(*) FROM %1$I.nuvemshop_produtos n
                 WHERE public.normalizar_sku(n.sku) = public.normalizar_sku(p.codigo))::INTEGER,
               CASE WHEN $2 IS NULL THEN NULL
                    ELSE round(extensions.similarity(public.normalizar_nome(p.nome), $2)::NUMERIC, 3) END
        FROM %1$I.produtos p
        WHERE p.situacao = ''A''
          AND public.normalizar_sku(p.codigo) IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM unnest($1) w
                WHERE w <> '''' AND position(w IN public.normalizar_nome(p.nome || '' '' || p.codigo)) = 0)
        ORDER BY 7 DESC NULLS LAST, p.nome
        LIMIT $3
    ', p_schema_name) USING v_palavras, v_chave, GREATEST(LEAST(p_limite, 100), 1);
END;
$$;

REVOKE ALL ON FUNCTION buscar_produtos_bling(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION buscar_produtos_bling(TEXT, TEXT, TEXT, INTEGER) TO authenticated;
