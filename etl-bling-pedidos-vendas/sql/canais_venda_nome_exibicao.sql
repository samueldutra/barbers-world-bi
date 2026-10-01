-- Nome de exibição dos canais no BI (não altera nada no Bling).
-- Execute substituindo "barbers" pelo schema do cliente, se for reusar para outro tenant.
--
-- canais_venda.descricao continua sendo o nome que TODO o BI lê (dashboard, relatórios,
-- conferência de preços). Ela passa a ser COALESCE(nome_exibicao, nome do Bling):
--   - nome_exibicao   → nome definido pra o BI (NULL = usa o nome do Bling)
--   - descricao_bling → último nome vindo do Bling (sync-canais-venda-bling.py)
-- processar_carga_canais_venda mantém essa regra a cada sync, então o renome não é
-- desfeito pelo workflow horário. Pra renomear outro canal: UPDATE abaixo com o id_loja.

ALTER TABLE barbers.canais_venda ADD COLUMN IF NOT EXISTS nome_exibicao   VARCHAR(200);
ALTER TABLE barbers.canais_venda ADD COLUMN IF NOT EXISTS descricao_bling VARCHAR(200);

UPDATE barbers.canais_venda SET descricao_bling = descricao WHERE descricao_bling IS NULL;

UPDATE barbers.canais_venda c
SET nome_exibicao = v.nome, descricao = v.nome
FROM (VALUES
    (205942205, 'TIKTOK SHOP'),    -- Bling: D LEGEND BARBERS
    (206016028, 'SHOPEE'),         -- Bling: DLEGEND SHOPEE
    (205869227, 'MERCADO LIVRE'),  -- Bling: BARBERS ML
    (204968632, 'LOJA FÍSICA'),    -- Bling: BARBERS WORLD
    (0,         'ATACADO')         -- linha sintética (pedidos sem loja no Bling)
) AS v(id_loja, nome)
WHERE c.id_loja = v.id_loja;
