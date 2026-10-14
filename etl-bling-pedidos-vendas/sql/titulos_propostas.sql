-- Taxonomia de títulos das MÁQUINAS (corte, acabamento, shaver) — propostas, auditoria e RPCs de gravação.
-- Regras (decididas com o cliente em 14/10/2026): TUDO MAIÚSCULO; formato
--   [MÁQUINA DE CORTE | MÁQUINA DE ACABAMENTO | MÁQUINA SHAVER] [MARCA] [MODELO] [COR] [CORDLESS] [VOLTAGEM];
-- cores em português (exceção: Cocco mantém a grafia original da marca); Gamma+ separada de StyleCraft pela LINHA do produto;
-- grafia BabylissPro padronizada (FXONE, LO-PRO, SNAP FX, CORE FX, TOMB45); BIVOLT acrescentado quando o título não traz voltagem;
-- título igual na Nuvemshop e no Bling. A função public.titulo_maquina_proposto() gera a proposta a partir do nome atual
-- (a lógica fina — marca por linha, Cocco, BIVOLT — foi aplicada em UPDATEs sobre a tabela; ver o final deste arquivo).
-- NADA é gravado nas lojas por aqui: quem grava é etl-bling-pedidos-vendas/aplicar-titulos-maquinas.py, só linhas APROVADO.

CREATE TABLE IF NOT EXISTS barbers.titulos_propostas (
    store_id          BIGINT NOT NULL,
    id_produto_ns     BIGINT NOT NULL,
    familia           VARCHAR(20) NOT NULL,            -- CORTE | ACABAMENTO | SHAVER (pela categoria na Nuvemshop)
    marca             VARCHAR(200),
    titulo_atual      VARCHAR(300) NOT NULL,           -- nome atual na Nuvemshop
    titulo_proposto   VARCHAR(300) NOT NULL,
    status            VARCHAR(12) NOT NULL,            -- APROVADO | REVISAR | BLOQUEADO (só APROVADO é gravado)
    pendencias        TEXT,
    regra_versao      VARCHAR(20) NOT NULL DEFAULT 'maquinas-v2',
    gerado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    aplicado_em       TIMESTAMPTZ,                     -- gravado na Nuvemshop
    marca_cadastro    TEXT,                            -- marca hoje no cadastro da Nuvemshop
    marca_sugerida    TEXT,                            -- sugestão de marca (Gamma+ x StyleCraft); NÃO é gravada
    evidencia_marca   TEXT,
    id_produto_bling  BIGINT,                          -- produto do Bling pelo SKU idêntico
    titulo_bling_atual TEXT,
    aplicado_bling_em TIMESTAMPTZ,                     -- gravado no Bling
    PRIMARY KEY (store_id, id_produto_ns)
);
ALTER TABLE barbers.titulos_propostas ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS barbers.titulos_alteracoes (
    id                 BIGSERIAL PRIMARY KEY,
    sistema            VARCHAR(10) NOT NULL,           -- 'nuvemshop' | 'bling'
    store_id           BIGINT,
    id_produto_ns      BIGINT,
    id_produto_bling   BIGINT,
    titulo_anterior    TEXT,
    titulo_novo        TEXT NOT NULL,
    sucesso            BOOLEAN NOT NULL,
    erro               TEXT,
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE barbers.titulos_alteracoes ENABLE ROW LEVEL SECURITY;

-- Próximas linhas a gravar (APROVADO, título diferente do atual no sistema, ainda não aplicado nele).
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
                   ELSE t.aplicado_bling_em IS NULL AND t.id_produto_bling IS NOT NULL AND t.titulo_proposto <> COALESCE(t.titulo_bling_atual, '') END
        ORDER BY t.familia, t.titulo_proposto
        LIMIT %3$L
    $q$, p_schema_name, p_sistema, GREATEST(p_limite, 1));
END;
$$;

-- Registra a tentativa e, em sucesso, marca a linha como aplicada naquele sistema.
CREATE OR REPLACE FUNCTION registrar_titulo_aplicado(
    p_schema_name TEXT, p_sistema TEXT, p_store_id BIGINT, p_id_produto_ns BIGINT, p_id_produto_bling BIGINT,
    p_anterior TEXT, p_novo TEXT, p_sucesso BOOLEAN, p_erro TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    EXECUTE format('INSERT INTO %I.titulos_alteracoes (sistema, store_id, id_produto_ns, id_produto_bling, titulo_anterior, titulo_novo, sucesso, erro)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', p_schema_name)
        USING p_sistema, p_store_id, p_id_produto_ns, p_id_produto_bling, p_anterior, p_novo, p_sucesso, p_erro;
    IF p_sucesso THEN
        IF p_sistema = 'nuvemshop' THEN
            EXECUTE format('UPDATE %I.titulos_propostas SET aplicado_em = now() WHERE store_id = $1 AND id_produto_ns = $2', p_schema_name) USING p_store_id, p_id_produto_ns;
        ELSE
            EXECUTE format('UPDATE %I.titulos_propostas SET aplicado_bling_em = now() WHERE store_id = $1 AND id_produto_ns = $2', p_schema_name) USING p_store_id, p_id_produto_ns;
        END IF;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION obter_titulos_a_aplicar(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION registrar_titulo_aplicado(TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION obter_titulos_a_aplicar(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION registrar_titulo_aplicado(TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, BOOLEAN, TEXT) TO service_role;
