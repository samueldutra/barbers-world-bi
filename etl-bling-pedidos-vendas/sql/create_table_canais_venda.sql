-- Dimensão de canais de venda (Bling: /canais-venda). Baixo volume (dezenas de linhas),
-- sincronizada sob demanda (não precisa de agendamento).
-- Execute substituindo "barbers" pelo schema do cliente, se for reusar para outro tenant.

CREATE TABLE IF NOT EXISTS barbers.canais_venda (
    id_loja         BIGINT PRIMARY KEY,
    descricao        VARCHAR(200),
    tipo             VARCHAR(50),      -- ex.: Nuvemshop, Shopee, MercadoLivre, TikTok, LojaFisica
    grupo            VARCHAR(50),      -- rótulo amigável pro BI (ver mapear_grupo() no script)
    situacao         SMALLINT,         -- 1 Habilitado, 2 Desabilitado
    data_sincronizacao TIMESTAMPTZ NOT NULL
);

-- Linha sintética: pedidos do Bling sem loja/canal associado (loja.id = 0 na API) são
-- vendas diretas/atacado lançadas manualmente, sem integração — não é "canal
-- desconhecido", é um canal de venda que o Bling não rotula.
INSERT INTO barbers.canais_venda (id_loja, descricao, tipo, grupo, situacao, data_sincronizacao)
VALUES (0, 'Venda Direta / Atacado', 'VendaDireta', 'Venda Direta/Atacado', 1, now())
ON CONFLICT (id_loja) DO NOTHING;
