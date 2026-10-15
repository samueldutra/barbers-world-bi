-- Taxonomia de títulos dos SECADORES (categoria SECADORES 30858188; só os produtos cujo nome começa por "SECADOR") — regra "secadores-v1".
-- Usa as tabelas e RPCs de titulos_propostas.sql (barbers.titulos_propostas, titulos_alteracoes, obter_titulos_a_aplicar,
-- registrar_titulo_aplicado) e a gravação de aplicar-titulos-maquinas.py (nome do produto; só linhas APROVADO).
--
-- Padrão (decidido com o cliente em 15/10/2026): TUDO MAIÚSCULO; `SECADOR DE CABELO MARCA MODELO COR POTÊNCIA VOLTAGEM`;
-- cor em português no MASCULINO (PRETO, BRANCO, AMARELO, DOURADO…; ROSE GOLD mantido, é o nome do acabamento); potência e voltagem COLADAS
-- (2100W, 127V, 220V) com a voltagem EXATA do título (110/127/220 V ou BIVOLT) — nunca se assume BIVOLT; marca canônica
-- (BABYLISS/BABYLISS PRO → BABYLISSPRO; GA.MA/GAMMA → GA.MA ITALY). Kits, combos, suportes, difusores e esterilizador da categoria
-- NÃO entram (ficam para os grupos próprios).

CREATE OR REPLACE FUNCTION public.titulo_secador_proposto(p_nome TEXT, p_marca TEXT)
RETURNS TABLE(titulo TEXT, status TEXT, pendencias TEXT, marca_titulo TEXT)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    t TEXT;
    m TEXT := upper(btrim(COALESCE(p_marca, '')));
    marca_c TEXT;
    alias_re TEXT;
    resto TEXT;
    volt TEXT := NULL;
    potencia TEXT := NULL;
    ultimo TEXT;
    pend TEXT[] := ARRAY[]::TEXT[];
    rev BOOLEAN := FALSE;
    tinha_marca BOOLEAN;
    antes TEXT;
    tm TEXT[];
    cores CONSTANT JSONB := '{"BLACK":"PRETO","PRETO":"PRETO","PRETA":"PRETO","WHITE":"BRANCO","BRANCO":"BRANCO","BRANCA":"BRANCO","RED":"VERMELHO","VERMELHO":"VERMELHO","VERMELHA":"VERMELHO","BLUE":"AZUL","AZUL":"AZUL","GREEN":"VERDE","VERDE":"VERDE","GRAY":"CINZA","GREY":"CINZA","CINZA":"CINZA","SILVER":"PRATA","PRATA":"PRATA","GOLD":"DOURADO","DOURADO":"DOURADO","ORANGE":"LARANJA","LARANJA":"LARANJA","PINK":"ROSA","ROSA":"ROSA","YELLOW":"AMARELO","YEELOW":"AMARELO","AMARELO":"AMARELO","AMARELA":"AMARELO"}';
BEGIN
    t := ' ' || regexp_replace(upper(btrim(normalize(p_nome, NFC))), '\s+', ' ', 'g') || ' ';
    t := replace(t, ' - ', ' ');
    antes := t;
    t := replace(t, 'YEELOW', 'YELLOW');
    t := regexp_replace(t, ' (110|127|220)V?TS ', ' \1V ', 'g');
    t := regexp_replace(t, ' (110|127|220)VGAMMA ', ' \1V ', 'g');
    t := replace(t, ' MANDE IN ITALY ', ' MADE IN ITALY ');
    IF t <> antes THEN rev := TRUE; pend := array_append(pend, 'erro de digitação corrigido no título (confirmar)'); END IF;
    IF t !~ '^ SECADOR ' THEN
        titulo := btrim(t); status := 'REVISAR'; pendencias := 'não é um secador (kit, suporte, difusor ou outro): fora desta regra'; marca_titulo := m; RETURN NEXT; RETURN;
    END IF;
    t := regexp_replace(t, '^ SECADOR( DE CABELO)? ', ' ');
    tm := regexp_match(t, ' (110|127|220)V ');
    IF tm IS NOT NULL THEN volt := tm[1] || 'V'; t := replace(t, ' ' || tm[1] || 'V ', ' ');
    ELSIF t ~ ' BIVOLT ' THEN volt := 'BIVOLT'; t := replace(t, ' BIVOLT ', ' '); END IF;
    IF volt IS NULL THEN rev := TRUE; pend := array_append(pend, 'voltagem ausente no título (110/127/220 V ou bivolt: confirmar)'); END IF;
    tm := regexp_match(t, ' (\d{3,4}) ?W ');
    IF tm IS NOT NULL THEN potencia := tm[1] || 'W'; t := regexp_replace(t, ' ' || tm[1] || ' ?W ', ' '); END IF;
    marca_c := CASE
        WHEN m LIKE 'BABYLISS%' THEN 'BABYLISSPRO'
        WHEN m IN ('GA.MA', 'GA.MA ITALY') THEN 'GA.MA ITALY'
        ELSE m END;
    alias_re := CASE marca_c
        WHEN 'BABYLISSPRO' THEN ' (BABYLISS PRO|BABYLISSPRO|BABYLISS) '
        WHEN 'GA.MA ITALY' THEN ' (GA\.MA ITALY|GA\.MA|GAMMA) '
        WHEN 'GBS' THEN ' (GBS|GAMMA) '
        ELSE ' ' || replace(replace(replace(marca_c, '.', '\.'), '+', '\+'), '/', '\/') || ' ' END;
    tinha_marca := t ~ alias_re;
    t := regexp_replace(t, alias_re, ' ', 'g');
    t := regexp_replace(t, '\s+', ' ', 'g');
    IF NOT tinha_marca THEN rev := TRUE; pend := array_append(pend, 'marca não constava no título (inserida a partir do cadastro)'); END IF;
    IF m = 'S/C STYLECRAFT' THEN t := regexp_replace(t, ' S\|C ', ' ', 'g'); tinha_marca := TRUE; END IF;
    resto := btrim(t);
    ultimo := (regexp_match(resto, '([^ ]+)$'))[1];
    IF ultimo IS NOT NULL AND cores ? ultimo AND resto <> ultimo THEN
        resto := regexp_replace(resto, ' ' || ultimo || '$', ' ' || (cores ->> ultimo));
    END IF;
    IF resto ~ 'ROSE GOLD$' THEN rev := TRUE; pend := array_append(pend, 'cor "ROSE GOLD" mantida em inglês (acabamento da marca): confirmar'); END IF;
    titulo := btrim(regexp_replace('SECADOR DE CABELO ' || marca_c || ' ' || resto || COALESCE(' ' || potencia, '') || COALESCE(' ' || volt, ''), '\s+', ' ', 'g'));
    status := CASE WHEN rev THEN 'REVISAR' ELSE 'APROVADO' END;
    pendencias := array_to_string(pend, '; ');
    marca_titulo := marca_c;
    RETURN NEXT;
END;
$$;

-- Aplicado como INSERT sobre barbers.titulos_propostas (familia = 'SECADOR', regra_versao = 'secadores-v1') para os produtos da categoria
-- SECADORES cujo nome começa por "SECADOR" (nome em NFC); correção do "ROSE GOLD" (a cor era traduzida por engano para "ROSE DOURADO"; mantido
-- "ROSE GOLD"); produto do Bling pelo SKU idêntico. Resultado de 15/10/2026: 62 secadores; 53 APROVADO + 9 REVISAR aprovados pelo cliente;
-- todos gravados na Nuvemshop e no Bling (62/62, 0 erros). Os 19 itens da categoria que não são secadores ficaram de fora.
