-- Gera as propostas de SKU (código) para os produtos ATIVOS do Bling sem código — ver rpc_sku_bling_propostas.sql.
-- Rodar UMA vez (ON CONFLICT DO NOTHING: não sobrescreve proposta já aprovada/aplicada). Trocar "barbers" pelo schema.
-- A linha cujo nome é só números (linha digitável de boleto cadastrada como produto) entra como 'excluido'.

INSERT INTO barbers.sku_bling_propostas (id_produto, codigo_proposto, observacao, status)
WITH sem AS (
  SELECT id_produto, nome FROM barbers.produtos WHERE situacao = 'A' AND nullif(btrim(codigo), '') IS NULL
),
tok AS (
  SELECT s.id_produto, w.ord, regexp_replace(w.t, '[^A-Z0-9]', '', 'g') AS t
  FROM sem s,
  LATERAL unnest(regexp_split_to_array(
      upper(translate(regexp_replace(s.nome, '[/+,;()]', ' ', 'g'), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
      '\s+')) WITH ORDINALITY AS w(t, ord)
),
sig AS (  -- palavras significativas, em ordem
  SELECT id_produto, t, row_number() OVER (PARTITION BY id_produto ORDER BY ord) AS pos
  FROM tok WHERE t <> '' AND t NOT IN ('DE','DA','DO','DAS','DOS','PARA','COM','E','EM','NA','NO','C')
),
base AS (
  SELECT s.id_produto, s.nome,
         coalesce(nullif((SELECT string_agg(CASE WHEN t ~ '[0-9]' THEN t ELSE left(t,1) END, '' ORDER BY pos) FROM sig WHERE sig.id_produto = s.id_produto), ''), 'PROD') AS base,
         (SELECT string_agg(t, ' ' ORDER BY pos) FROM sig WHERE sig.id_produto = s.id_produto) AS palavras,
         (SELECT count(*) FROM sig WHERE sig.id_produto = s.id_produto) AS qtd_palavras
  FROM sem s
),
existentes AS (SELECT DISTINCT public.normalizar_sku(codigo) AS c FROM barbers.produtos WHERE situacao = 'A' AND public.normalizar_sku(codigo) IS NOT NULL),
final AS (
  SELECT b.*, count(*) OVER (PARTITION BY base) AS grupo,
         row_number() OVER (PARTITION BY base ORDER BY id_produto)
           + CASE WHEN EXISTS (SELECT 1 FROM existentes e WHERE e.c = b.base) THEN 1 ELSE 0 END AS n,
         EXISTS (SELECT 1 FROM existentes e WHERE e.c = b.base) AS base_existe
  FROM base b
),
cod AS (SELECT *, base || CASE WHEN n > 1 THEN n::TEXT ELSE '' END AS codigo_antigo, length(base) <= 2 AS curto FROM final),
fixos AS (SELECT codigo_antigo AS c FROM cod WHERE NOT curto),
-- base curta -> 3 letras. A: 1 palavra = 3 primeiras; 2+ = 1ª da 1ª + 2 primeiras da 2ª. B (se A repetir): 1ª da 1ª + 1ª e última da 2ª.
cand AS (
  SELECT c.*,
    CASE WHEN qtd_palavras = 1 THEN left(split_part(palavras,' ',1),3)
         ELSE left(split_part(palavras,' ',1),1) || left(split_part(palavras,' ',2),2) END AS cand_a,
    CASE WHEN qtd_palavras = 1 THEN NULL
         ELSE left(split_part(palavras,' ',1),1) || left(split_part(palavras,' ',2),1) || right(split_part(palavras,' ',2),1) END AS cand_b
  FROM cod c WHERE curto
),
ra AS (SELECT *, row_number() OVER (PARTITION BY cand_a ORDER BY id_produto) AS r FROM cand),
res AS (
  SELECT ra.*,
    (ra.r = 1 AND NOT EXISTS (SELECT 1 FROM fixos f WHERE f.c = ra.cand_a) AND NOT EXISTS (SELECT 1 FROM existentes e WHERE e.c = ra.cand_a)) AS usa_a
  FROM ra
),
todos AS (
  SELECT id_produto, nome, codigo_antigo AS codigo,
         concat_ws(' | ',
           CASE WHEN length(codigo_antigo) > 15 THEN 'codigo longo' END,
           CASE WHEN n > 1 AND NOT base_existe THEN 'desempate' END,
           CASE WHEN base_existe THEN 'base ja existia no Bling' END,
           CASE WHEN n = 1 AND grupo > 1 THEN 'primeiro do grupo' END) AS obs
  FROM cod WHERE NOT curto
  UNION ALL
  SELECT id_produto, nome, CASE WHEN usa_a THEN cand_a ELSE cand_b END,
         '3 letras (antes: ' || codigo_antigo || ')' || CASE WHEN usa_a THEN '' ELSE ' | variante p/ evitar repetição' END
  FROM res
)
SELECT id_produto, codigo,
       CASE WHEN nome ~ '^[0-9 ]+$' THEN 'nome parece linha digitável de boleto — não gerar SKU' ELSE obs END,
       CASE WHEN nome ~ '^[0-9 ]+$' THEN 'excluido' ELSE 'pendente' END
FROM todos
ON CONFLICT (id_produto) DO NOTHING;
