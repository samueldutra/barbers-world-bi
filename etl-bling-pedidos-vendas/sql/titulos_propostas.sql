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

-- ---------------------------------------------------------------------------------------------------------------------------
-- GERAÇÃO DAS PROPOSTAS (regra "maquinas-v2"). Passo 1: função que normaliza um nome (maiúsculas, tipo com acento no começo,
-- marca logo depois, cor em PT-BR no fim, CORDLESS e voltagem por último; só mantém o que já estava no título). Os passos 2 a 5
-- foram aplicados como UPDATEs sobre barbers.titulos_propostas (descritos abaixo, na ordem em que rodaram).
-- ---------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.titulo_maquina_proposto(p_nome TEXT, p_marca TEXT, p_familia TEXT)
RETURNS TABLE(titulo TEXT, status TEXT, pendencias TEXT)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    t TEXT; tipo TEXT; marca TEXT; resto TEXT; ultimo TEXT; cordless BOOLEAN; volt TEXT := NULL;
    pend TEXT[] := ARRAY[]::TEXT[]; rev BOOLEAN := FALSE; tem_tipo BOOLEAN; tem_marca BOOLEAN; antes TEXT;
    cores CONSTANT JSONB := '{"BLACK":"PRETA","PRETA":"PRETA","PRETO":"PRETA","WHITE":"BRANCA","BRANCA":"BRANCA","BRANCO":"BRANCA","RED":"VERMELHA","VERMELHA":"VERMELHA","BLUE":"AZUL","AZUL":"AZUL","GREEN":"VERDE","VERDE":"VERDE","GRAY":"CINZA","GREY":"CINZA","CINZA":"CINZA","SILVER":"PRATA","PRATA":"PRATA","GOLD":"DOURADA","DOURADA":"DOURADA","ORANGE":"LARANJA","LARANJA":"LARANJA","PINK":"ROSA","ROSA":"ROSA","CYAN":"CIANO","LILAS":"LILÁS","LILÁS":"LILÁS","BORDO":"BORDÔ","BORDÔ":"BORDÔ","AMARELO":"AMARELA","AMARELA":"AMARELA","ROXA":"ROXA","ROXO":"ROXA"}';
BEGIN
    t := ' ' || regexp_replace(upper(btrim(p_nome)), '\s+', ' ', 'g') || ' ';
    t := replace(t, 'S|C', ' STYLECRAFT ');
    t := replace(replace(t, 'ESTYLE CRAFT', 'STYLECRAFT'), 'STYLE CRAFT', 'STYLECRAFT');
    t := replace(t, 'EDITON', 'EDITION');
    t := replace(t, 'PROFOILL', 'PROFOIL');
    t := replace(t, ' MAQUINA ', ' MÁQUINA ');
    t := replace(t, ' - ', ' ');
    t := regexp_replace(t, '\s+', ' ', 'g');
    tipo := CASE p_familia WHEN 'CORTE' THEN 'MÁQUINA DE CORTE' WHEN 'ACABAMENTO' THEN 'MÁQUINA DE ACABAMENTO' ELSE 'MÁQUINA SHAVER' END;
    tem_tipo := t ~ ' MÁQUINA DE (CORTE|ACABAMENTO) ' OR t ~ ' MÁQUINA SHAVER ';
    IF NOT tem_tipo THEN rev := TRUE; pend := array_append(pend, 'tipo da máquina inferido da categoria (não consta no título atual)'); END IF;
    t := regexp_replace(t, ' MÁQUINA( DE)? ', ' ', 'g');
    t := CASE p_familia WHEN 'CORTE' THEN replace(t, ' CORTE ', ' ') WHEN 'ACABAMENTO' THEN replace(t, ' ACABAMENTO ', ' ') ELSE replace(t, ' SHAVER ', ' ') END;
    t := replace(t, ' COR ', ' ');
    cordless := t ~ ' CORDLESS ';
    t := replace(t, ' CORDLESS ', ' ');
    IF t ~ ' BIVOLT ' THEN volt := 'BIVOLT'; t := replace(t, ' BIVOLT ', ' ');
    ELSIF t ~ ' 110 ?V ' THEN volt := '110 V'; t := regexp_replace(t, ' 110 ?V ', ' ');
    ELSIF t ~ ' 220 ?V ' THEN volt := '220 V'; t := regexp_replace(t, ' 220 ?V ', ' ');
    END IF;
    IF volt IS NULL THEN pend := array_append(pend, 'voltagem ausente no título (confirmar com o fabricante)'); END IF;
    t := regexp_replace(t, ' VGR[ -]V?-?([0-9])', ' VGR V-\1', 'g');
    t := regexp_replace(t, ' (GMT|HC|ZB) ([0-9])', ' \1-\2', 'g');
    IF upper(p_marca) LIKE 'BABYLISS%' THEN
        antes := t;
        t := replace(t, ' LO PRO ', ' LO-PRO ');
        t := replace(t, ' LOPROFX ', ' LO-PRO FX ');
        t := replace(t, ' FX ONE ', ' FXONE ');
        t := replace(t, ' SNAPFX ', ' SNAP FX ');
        t := replace(t, ' COREFX ', ' CORE FX ');
        t := replace(t, ' TOMB 45 ', ' TOMB45 ');
        IF t <> antes THEN rev := TRUE; pend := array_append(pend, 'grafia do modelo BabylissPro padronizada (FXONE, LO-PRO, SNAP FX…): confirmar a grafia oficial'); END IF;
    END IF;
    IF t ~ ' STYLECRAFT ' THEN marca := 'STYLECRAFT';
    ELSIF t ~ ' GAMMA\+? ' OR upper(p_marca) LIKE 'GAMMA%' THEN marca := 'GAMMA+';
    ELSIF upper(p_marca) LIKE 'BABYLISS%' THEN marca := 'BABYLISSPRO';
    ELSIF upper(p_marca) LIKE 'JUCAI%' THEN marca := 'JUCAI';
    ELSE marca := upper(btrim(p_marca)); END IF;
    IF marca IN ('STYLECRAFT','GAMMA+') THEN rev := TRUE; pend := array_append(pend, 'marca Gamma+ x StyleCraft a confirmar (linha de qual marca?)'); END IF;
    tem_marca := CASE marca
        WHEN 'BABYLISSPRO' THEN t ~ ' BABYLISS(PRO)? '
        WHEN 'GAMMA+' THEN t ~ ' GAMMA\+? '
        WHEN 'GA.MA ITALY' THEN t ~ ' GA\.MA ITALY '
        ELSE position(' ' || marca || ' ' IN t) > 0 END;
    IF NOT tem_marca THEN rev := TRUE; pend := array_append(pend, 'marca não constava no título (inserida a partir do cadastro)'); END IF;
    t := CASE marca
        WHEN 'BABYLISSPRO' THEN regexp_replace(t, ' BABYLISS(PRO)? ', ' ', 'g')
        WHEN 'GAMMA+' THEN regexp_replace(t, ' GAMMA\+? ', ' ', 'g')
        WHEN 'STYLECRAFT' THEN regexp_replace(regexp_replace(t, ' STYLECRAFT ', ' ', 'g'), ' GAMMA\+? ', ' ', 'g')
        WHEN 'GA.MA ITALY' THEN regexp_replace(t, ' GA\.MA ITALY ', ' ', 'g')
        ELSE replace(t, ' ' || marca || ' ', ' ') END;
    t := regexp_replace(t, '\s+', ' ', 'g');
    resto := btrim(t);
    ultimo := (regexp_match(resto, '([^ ]+)$'))[1];
    IF resto ~ '(^| )[A-ZÁ-Ú]+/[A-ZÁ-Ú]+$' THEN
        rev := TRUE; pend := array_append(pend, 'duas cores (nome oficial do fabricante mantido)');
    ELSIF ultimo IS NOT NULL AND cores ? ultimo AND resto <> ultimo THEN
        resto := regexp_replace(resto, ' ' || ultimo || '$', ' ' || (cores ->> ultimo));
    END IF;
    titulo := btrim(regexp_replace(tipo || ' ' || marca || ' ' || resto || CASE WHEN cordless THEN ' CORDLESS' ELSE '' END || COALESCE(' ' || volt, ''), '\s+', ' ', 'g'));
    status := CASE WHEN rev THEN 'REVISAR' ELSE 'APROVADO' END;
    pendencias := array_to_string(pend, '; ');
    RETURN NEXT;
END;
$$;

-- Passo 2: INSERT ... SELECT da função sobre os produtos das categorias MÁQUINAS DE CORTE (41220764), DE ACABAMENTO (41220765)
--          e SHAVER (41220766), com o nome normalizado em NFC (o catálogo tem acentos decompostos).
-- Passo 3: Gamma+ x StyleCraft pela LINHA: Boosted, Boosted Up, Shorty, Golden Gun, Cyborg, X-Ergo = GAMMA+; as demais
--          (Saber, Instinct, Rebel, Ergo, Ace, Absolute Hitter, Wireless Prodigy, Master Deluxe) = STYLECRAFT. Sugestão de marca em
--          marca_sugerida (NÃO grava no cadastro). Só vira REVISAR se a marca do título mudou ou não constava, ou se não há confirmação externa.
-- Passo 4: Cocco mantém a grafia original da marca (cores em inglês); BIVOLT acrescentado onde faltava voltagem (decisão do cliente).
-- Passo 5: produto do Bling pelo SKU idêntico (id_produto_bling / titulo_bling_atual); status = APROVADO quando só resta a nota do BIVOLT.
