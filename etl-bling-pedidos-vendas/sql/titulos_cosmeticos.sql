-- Taxonomia de títulos dos COSMÉTICOS (categoria COSMÉTICOS e subcategorias PARA BARBA/CABELO/CORPO/ROSTO) — regra "cosmeticos-v3".
-- Usa as tabelas e RPCs de titulos_propostas.sql (barbers.titulos_propostas, titulos_alteracoes, obter_titulos_a_aplicar,
-- registrar_titulo_aplicado) e a mesma gravação: aplicar-titulos-maquinas.py (nome do produto; só linhas APROVADO).
--
-- Padrão (decidido com o cliente em 14/10/2026): TUDO MAIÚSCULO; `TIPO MARCA LINHA/VARIANTE PESO-VOLUME [N UNIDADES]`;
-- acentos corrigidos (LOCAO→LOÇÃO, OLEO→ÓLEO, MASCARA→MÁSCARA, PÓS-BARBA…); unidades COLADAS (250G, 500ML, 1,05L); água oxigenada/oxidante
-- com "20 VOLUMES"; grafia das marcas nos títulos: FOX FOR MEN, ALFA LOOK'S, GARDEN FOR MEN, ZAP COSMÉTICOS, RESSURGE FOR MEN.
-- O campo marca do cadastro foi alinhado ao mesmo padrão (FOX→FOX FOR MEN, ALFA LOOK/ALFA LOOKS→ALFA LOOK'S, GARDEN→GARDEN FOR MEN).

-- Passo 1 — função base (tipo, marca, unidades, quantidade de caixa).
CREATE OR REPLACE FUNCTION public.titulo_cosmetico_proposto(p_nome TEXT, p_marca TEXT)
RETURNS TABLE(titulo TEXT, status TEXT, pendencias TEXT, marca_titulo TEXT)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    t TEXT;
    m TEXT := upper(btrim(COALESCE(p_marca, '')));
    marca_c TEXT;
    alias_re TEXT;
    tipo TEXT := NULL;
    resto TEXT;
    un TEXT := NULL;
    pack TEXT := NULL;
    pend TEXT[] := ARRAY[]::TEXT[];
    rev BOOLEAN := FALSE;
    tinha_marca BOOLEAN;
    n_unidades INTEGER;
    k TEXT; v TEXT;
    dic CONSTANT JSONB := '{
        "LOCAO POS BARBA":"LOÇÃO PÓS-BARBA","LOÇÃO POS BARBA":"LOÇÃO PÓS-BARBA","LOÇÃO PÓS BARBA":"LOÇÃO PÓS-BARBA","LOCAO PÓS-BARBA":"LOÇÃO PÓS-BARBA","LOCAO PÓS BARBA":"LOÇÃO PÓS-BARBA",
        "CREME POS BARBA":"CREME PÓS-BARBA","CREME PÓS BARBA":"CREME PÓS-BARBA","POS BARBA":"PÓS-BARBA","PÓS BARBA":"PÓS-BARBA","POS-BARBA":"PÓS-BARBA",
        "LOCAO":"LOÇÃO","OLEO":"ÓLEO","MASCARA":"MÁSCARA","TONICO":"TÔNICO","AGUA":"ÁGUA","PO DESCOLORANTE":"PÓ DESCOLORANTE","POMADA EM PO":"POMADA EM PÓ",
        "HIDRATACAO":"HIDRATAÇÃO","NUTRICAO":"NUTRIÇÃO","RESTAURACAO":"RESTAURAÇÃO","PIGMENTACAO":"PIGMENTAÇÃO","COLORACAO":"COLORAÇÃO",
        "ACIDO":"ÁCIDO","HIALURONICO":"HIALURÔNICO","SERUM":"SÉRUM","BALSAMO":"BÁLSAMO","ANTISSEPTICO":"ANTISSÉPTICO","EM PO":"EM PÓ"
    }';
    tipos_multi CONSTANT TEXT := 'POMADA MODELADORA EM PÓ|POMADA EM PÓ|MAQUIAGEM CAPILAR|FIBRA CAPILAR|TINTA SPRAY PARA CABELO|TINTA SPRAY|HAIR SPRAY|SHAVING GEL|SHAVING CREAM|SHAVING CREME|SHAVE CREAM|SHAVE GEL|AFTER SHAVE|GEL COLA|GEL CERA|LOÇÃO PÓS-BARBA|CREME PÓS-BARBA|CREME CORPORAL|CREME FACIAL|CREME ESFOLIANTE|CREME OXIDANTE|ESFOLIANTE FACIAL|SÉRUM FACIAL|SÉRUM RENOVADOR|MÁSCARA CONDICIONANTE|MÁSCARA CAPILAR|MÁSCARA FACIAL|BODY SPLASH|PERFUME DE TOALHAS|PÓ DESCOLORANTE|ÁGUA OXIGENADA|TÔNICO CAPILAR|TALCO ANTISSÉPTICO|REFIL LIMPADOR FACIAL|REFIL SHAVING GEL|HIDRATANTE FACIAL|BÁLSAMO HIDRATANTE|ESPUMA HIGIENIZADORA|PROTETOR DE LÂMINA|RESFRIADOR DE LÂMINA|FATOR DE CRESCIMENTO|ATIVADOR DE QUERATINA|COLORAÇÃO PERMANENTE|SPRAY FIXADOR|SPRAY REPAIR|POMADA MODELADORA|PASTA MODELADORA|CERA MODELADORA|CERA BIGODE|LEAVE-IN PARA CABELO|LEAVE-IN PARA BARBA|BALM PARA BARBA|GROOMING PARA CABELO|ÓLEO PARA BARBA|SHAMPOO PARA BARBA|SHAMPOO PARA CABELO';
    tipos_uni CONSTANT TEXT[] := ARRAY['POMADA','SHAMPOO','CONDICIONADOR','LEAVE-IN','BALM','GROOMING','ÓLEO','KIT','GEL','PASTA','CERA','MÁSCARA','LOÇÃO','TALCO','ESFOLIANTE','CREME','TÔNICO','SÉRUM','HIDRATANTE','DESODORANTE','ESPUMA','ATIVADOR','PROTETOR','MODELADOR','REFIL','ALISAMENTO','BÁLSAMO','PERFUME','SPRAY','PERFUME','COLORAÇÃO','PIGMENTAÇÃO','MINOXWAX'];
    tm TEXT[];
BEGIN
    t := ' ' || regexp_replace(upper(btrim(normalize(p_nome, NFC))), '\s+', ' ', 'g') || ' ';
    t := replace(t, ' | ', ' ');
    FOR k, v IN SELECT * FROM jsonb_each_text(dic) ORDER BY length(key) DESC LOOP
        t := replace(t, ' ' || k || ' ', ' ' || v || ' ');
    END LOOP;
    t := replace(t, ' POS ', ' PÓS ');
    t := regexp_replace(t, '\s+', ' ', 'g');
    t := regexp_replace(t, ' (\d+)[.,](\d+) ?(ML|L|G|GR|KG) ', ' \1,\2 \3 ', 'g');
    t := regexp_replace(t, ' (\d+(,\d+)?) ?(ML|L|G|GR|KG) ', ' \1 \3 ', 'g');
    t := regexp_replace(t, ' (\d+(,\d+)?) GR ', ' \1 G ', 'g');
    n_unidades := (SELECT count(*) FROM regexp_matches(t, ' \d+(,\d+)? (ML|L|G|KG) ', 'g'));
    tm := regexp_match(t, ' (\d+(,\d+)?) (ML|L|G|KG) ');
    IF tm IS NOT NULL THEN
        un := tm[1] || ' ' || tm[3];
        t := regexp_replace(t, ' ' || tm[1] || ' ' || tm[3] || ' ', ' ');
    END IF;
    IF n_unidades > 1 THEN rev := TRUE; pend := array_append(pend, 'mais de um peso/volume no título'); END IF;
    IF un IS NULL THEN rev := TRUE; pend := array_append(pend, 'peso/volume ausente no título'); END IF;
    tm := regexp_match(t, ' (\d+) UNIDADES? ');
    IF tm IS NOT NULL THEN
        pack := tm[1] || CASE WHEN tm[1] = '1' THEN ' UNIDADE' ELSE ' UNIDADES' END;
        t := regexp_replace(t, ' \d+ UNIDADES? ', ' ');
    END IF;
    marca_c := CASE
        WHEN m IN ('FOX', 'FOX FOR MEN') THEN 'FOX FOR MEN'
        WHEN m IN ('ALFA LOOK', 'ALFA LOOKS', 'ALFA LOOK''S') THEN 'ALFA LOOKS'
        WHEN m IN ('GARDEN', 'GARDEN FOR MEN') THEN 'GARDEN FOR MEN'
        WHEN m LIKE 'ZAP%' THEN 'ZAP'
        WHEN m LIKE 'RESSURGE%' THEN 'RESSURGE FOR MEN'
        ELSE m END;
    alias_re := CASE marca_c
        WHEN 'FOX FOR MEN' THEN ' (FOX FOR MEN|FOX FOR MAN|FOX) '
        WHEN 'ALFA LOOKS' THEN ' (ALFA LOOK''S|ALFA LOOKS|ALFA LOOK) '
        WHEN 'GARDEN FOR MEN' THEN ' (GARDEN FOR MEN|GARDEN) '
        WHEN 'ZAP' THEN ' (ZAP COSMÉTICOS|ZAP) '
        WHEN 'RESSURGE FOR MEN' THEN ' (RESSURGE FOR MEN|RESSURGE FOR MAN) '
        ELSE ' ' || replace(replace(marca_c, '.', '\.'), '+', '\+') || ' ' END;
    tinha_marca := t ~ alias_re;
    t := regexp_replace(t, alias_re, ' ', 'g');
    t := regexp_replace(t, '\s+', ' ', 'g');
    IF NOT tinha_marca THEN pend := array_append(pend, 'marca inserida a partir do cadastro (não constava no título)'); END IF;
    IF marca_c = 'SPRAY APLICADOR' OR marca_c = '' THEN rev := TRUE; pend := array_append(pend, 'marca do cadastro parece errada ou vazia'); END IF;
    tm := regexp_match(t, '^ (' || tipos_multi || ') ');
    IF tm IS NOT NULL THEN tipo := tm[1];
    ELSE
        tm := regexp_match(t, '^ ([A-ZÀ-Ú-]+)( (PARA|DE|EM) [A-ZÀ-Ú-]+)? ');
        IF tm IS NOT NULL THEN
            tipo := tm[1] || COALESCE(tm[2], '');
            IF NOT (tm[1] = ANY (tipos_uni)) THEN rev := TRUE; pend := array_append(pend, 'tipo do produto não reconhecido (primeira palavra usada)'); END IF;
        END IF;
    END IF;
    IF tipo IS NULL THEN
        titulo := btrim(t); status := 'REVISAR'; pendencias := 'não foi possível identificar o tipo'; marca_titulo := marca_c; RETURN NEXT; RETURN;
    END IF;
    resto := btrim(substr(t, length(tipo) + 3));
    resto := btrim(regexp_replace(regexp_replace(resto, '^(- )+', ''), '( -)+$', ''));
    IF tipo = 'KIT' THEN rev := TRUE; pend := array_append(pend, 'kit: conferir os itens e a ordem manualmente'); END IF;
    titulo := btrim(regexp_replace(tipo || ' ' || marca_c || ' ' || resto || COALESCE(' ' || un, '') || COALESCE(' ' || pack, ''), '\s+', ' ', 'g'));
    status := CASE WHEN rev THEN 'REVISAR' ELSE 'APROVADO' END;
    pendencias := array_to_string(pend, '; ');
    marca_titulo := marca_c;
    RETURN NEXT;
END;
$$;

-- Passo 2 — correções de digitação (80Gg, 240mlL, 11Oml, 1 LT), tipos extras reconhecidos e qualificador junto do tipo
-- ("BALM BARBA <marca>", "ÓLEO BARBA <marca>").
CREATE OR REPLACE FUNCTION public.titulo_cosmetico_proposto_v2(p_nome TEXT, p_marca TEXT)
RETURNS TABLE(titulo TEXT, status TEXT, pendencias TEXT, marca_titulo TEXT)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    n TEXT;
    r RECORD;
    primeira TEXT;
    extras CONSTANT TEXT[] := ARRAY['DEFRIZANTE','FLUIDO','GELEIA','MATIZADOR','OXIDANTE','PÓS-BARBA','RESFRIADOR','SABÃO','SHAVING','AROMATIZANTE'];
    marca_re TEXT;
BEGIN
    n := ' ' || regexp_replace(upper(btrim(normalize(p_nome, NFC))), '\s+', ' ', 'g') || ' ';
    n := regexp_replace(n, ' (\d+)GG ', ' \1G ', 'g');
    n := regexp_replace(n, ' (\d+)(ML)L ', ' \1 \2 ', 'g');
    n := regexp_replace(n, ' (\d+) ?LT ', ' \1 L ', 'g');
    n := regexp_replace(n, ' (\d+)O(ML|G) ', ' \10 \2 ', 'g');
    n := replace(replace(replace(n, ' LAMINA ', ' LÂMINA '), ' SABAO ', ' SABÃO '), ' OZONIO ', ' OZÔNIO ');
    n := btrim(n);
    SELECT * INTO r FROM public.titulo_cosmetico_proposto(n, p_marca);
    titulo := r.titulo; status := r.status; pendencias := r.pendencias; marca_titulo := r.marca_titulo;
    marca_re := replace(replace(replace(marca_titulo, '.', '\.'), '+', '\+'), '''', '''');
    titulo := regexp_replace(titulo, '^(BALM|ÓLEO|SHAMPOO|LEAVE-IN|GROOMING|CONDICIONADOR|ESFOLIANTE|HIDRATANTE|SÉRUM|CREME|MÁSCARA) (' || marca_re || ') (BARBA|CABELO|CAPILAR|FACIAL|CORPORAL)( |$)', '\1 \3 \2\4');
    primeira := split_part(titulo, ' ', 1);
    IF pendencias LIKE '%tipo do produto não reconhecido%' AND primeira = ANY (extras) THEN
        pendencias := array_to_string(ARRAY(SELECT p FROM unnest(string_to_array(pendencias, '; ')) p WHERE p NOT LIKE 'tipo do produto não reconhecido%'), '; ');
    END IF;
    status := CASE WHEN COALESCE(pendencias, '') ~ '(peso/volume ausente|mais de um peso|marca do cadastro parece errada|kit:|tipo do produto não reconhecido|identificar o tipo)' THEN 'REVISAR' ELSE 'APROVADO' END;
    RETURN NEXT;
END;
$$;

-- Passo 3 — decisões finais do cliente: unidades coladas, "VOLUMES" por extenso e grafia das marcas nos títulos.
CREATE OR REPLACE FUNCTION public.titulo_cosmetico_proposto_v3(p_nome TEXT, p_marca TEXT)
RETURNS TABLE(titulo TEXT, status TEXT, pendencias TEXT, marca_titulo TEXT)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE r RECORD;
BEGIN
    SELECT * INTO r FROM public.titulo_cosmetico_proposto_v2(p_nome, p_marca);
    titulo := ' ' || r.titulo || ' ';
    titulo := regexp_replace(titulo, ' (\d+(,\d+)?) (ML|L|G|KG) ', ' \1\3 ', 'g');
    titulo := regexp_replace(titulo, ' (\d+)V ', ' \1 VOLUMES ', 'g');
    titulo := replace(titulo, ' ALFA LOOKS ', ' ALFA LOOK''S ');
    titulo := replace(titulo, ' ZAP ', ' ZAP COSMÉTICOS ');
    titulo := btrim(regexp_replace(titulo, '\s+', ' ', 'g'));
    status := r.status; pendencias := r.pendencias;
    marca_titulo := CASE r.marca_titulo WHEN 'ALFA LOOKS' THEN 'ALFA LOOK''S' WHEN 'ZAP' THEN 'ZAP COSMÉTICOS' ELSE r.marca_titulo END;
    RETURN NEXT;
END;
$$;

-- Passo 4 (aplicado como INSERT/UPDATE sobre barbers.titulos_propostas, familia = 'COSMETICO', regra_versao = 'cosmeticos-v3'):
--   * produtos = os da categoria COSMÉTICOS (37111592) e das subcategorias PARA BARBA (41223371), PARA CABELO (41223370), PARA O CORPO (41223372)
--     e PARA O ROSTO (41223373); nome em NFC; proposta = titulo_cosmetico_proposto_v3(nome, marca);
--   * produto do Bling por SKU idêntico (só produtos com 1 variante na Nuvemshop): id_produto_bling / titulo_bling_atual;
--   * status BLOQUEADO para linhas que não devem ser regravadas (nome renomeado à mão; EAN inválido no Bling).
-- Resultado de 14/10/2026: 470 produtos; 448 APROVADO (gravados na Nuvemshop e no Bling), 22 REVISAR (13 kits, 8 com o nome da linha primeiro,
-- 1 com a marca do cadastro errada) aguardando revisão manual.
