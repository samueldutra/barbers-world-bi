-- Reversão dos títulos no BLING (os cosméticos ficam padronizados só na Nuvemshop; decisão do usuário, 15/10/2026).
-- Restaura o nome original do Bling (titulo_anterior da PRIMEIRA gravação bem-sucedida em titulos_alteracoes) e limpa aplicado_bling_em.
-- Auditoria com sistema = 'bling-rev'. A fila de gravação no Bling (obter_titulos_a_aplicar) passa a ignorar a família COSMETICO.

CREATE OR REPLACE FUNCTION obter_titulos_a_reverter_bling(p_schema_name TEXT, p_familia TEXT, p_limite INTEGER)
RETURNS TABLE(store_id BIGINT, id_produto_ns BIGINT, id_produto_bling BIGINT, titulo_original TEXT, titulo_aplicado TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY EXECUTE format($q$
        SELECT t.store_id, t.id_produto_ns, t.id_produto_bling,
               (SELECT a.titulo_anterior FROM %1$I.titulos_alteracoes a
                 WHERE a.sistema = 'bling' AND a.sucesso AND a.id_produto_bling = t.id_produto_bling ORDER BY a.id LIMIT 1)::TEXT,
               (SELECT a.titulo_novo FROM %1$I.titulos_alteracoes a
                 WHERE a.sistema = 'bling' AND a.sucesso AND a.id_produto_bling = t.id_produto_bling ORDER BY a.id DESC LIMIT 1)::TEXT
        FROM %1$I.titulos_propostas t
        WHERE t.familia = %2$L AND t.aplicado_bling_em IS NOT NULL AND t.id_produto_bling IS NOT NULL
        ORDER BY t.titulo_proposto
        LIMIT %3$L
    $q$, p_schema_name, p_familia, GREATEST(p_limite, 1));
END;
$$;

CREATE OR REPLACE FUNCTION registrar_titulo_revertido_bling(
    p_schema_name TEXT, p_store_id BIGINT, p_id_produto_ns BIGINT, p_id_produto_bling BIGINT,
    p_anterior TEXT, p_novo TEXT, p_sucesso BOOLEAN, p_erro TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    EXECUTE format('INSERT INTO %I.titulos_alteracoes (sistema, store_id, id_produto_ns, id_produto_bling, titulo_anterior, titulo_novo, sucesso, erro)
                    VALUES (''bling-rev'', $1, $2, $3, $4, $5, $6, $7)', p_schema_name)
        USING p_store_id, p_id_produto_ns, p_id_produto_bling, p_anterior, p_novo, p_sucesso, p_erro;
    IF p_sucesso THEN
        EXECUTE format('UPDATE %I.titulos_propostas SET aplicado_bling_em = NULL, titulo_bling_atual = $3 WHERE store_id = $1 AND id_produto_ns = $2', p_schema_name)
            USING p_store_id, p_id_produto_ns, p_novo;
    END IF;
END;
$$;

-- Fila normal do Bling não regrava os cosméticos.
CREATE OR REPLACE FUNCTION obter_titulos_a_aplicar(p_schema_name TEXT, p_sistema TEXT, p_limite INTEGER)
RETURNS TABLE(store_id BIGINT, id_produto_ns BIGINT, id_produto_bling BIGINT, familia TEXT, titulo_atual TEXT, titulo_bling_atual TEXT, titulo_proposto TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_sistema NOT IN ('nuvemshop', 'bling') THEN RAISE EXCEPTION 'Sistema inválido'; END IF;
    RETURN QUERY EXECUTE format($q$
        SELECT t.store_id, t.id_produto_ns, t.id_produto_bling, t.familia::TEXT, t.titulo_atual::TEXT, t.titulo_bling_atual, t.titulo_proposto::TEXT
        FROM %1$I.titulos_propostas t
        WHERE t.status = 'APROVADO'
          AND CASE WHEN %2$L = 'nuvemshop' THEN t.aplicado_em IS NULL AND t.titulo_proposto <> t.titulo_atual
                   ELSE t.aplicado_bling_em IS NULL AND t.id_produto_bling IS NOT NULL AND t.familia <> 'COSMETICO'
                        AND t.titulo_proposto <> COALESCE(t.titulo_bling_atual, '') END
        ORDER BY t.familia, t.titulo_proposto
        LIMIT %3$L
    $q$, p_schema_name, p_sistema, GREATEST(p_limite, 1));
END;
$$;

REVOKE ALL ON FUNCTION obter_titulos_a_reverter_bling(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION registrar_titulo_revertido_bling(TEXT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION obter_titulos_a_reverter_bling(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION registrar_titulo_revertido_bling(TEXT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, BOOLEAN, TEXT) TO service_role;
