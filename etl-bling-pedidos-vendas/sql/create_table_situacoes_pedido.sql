-- Dimensão de situações de pedido de venda (Bling: GET /situacoes/modulos/{idModulo}).
-- Baixo volume (dezenas de linhas), sincronizada sob demanda por sync-situacoes-bling.py —
-- rodar de novo sempre que uma situação for criada/renomeada no Bling.
-- Execute substituindo "barbers" pelo schema do cliente, se for reusar para outro tenant.
--
-- pedidos_vendas só guarda id_situacao/valor_situacao; o nome vem daqui. Situações
-- personalizadas do Bling (ex.: "VENDA LOJA", "Eventos/Workshop") herdam de uma situação
-- padrão (id_herdado — ex.: 6 = Em aberto), o que ajuda a entender o que cada uma significa.

CREATE TABLE IF NOT EXISTS barbers.situacoes_pedido (
    id_situacao        BIGINT PRIMARY KEY,
    nome               VARCHAR(200) NOT NULL,
    id_herdado         BIGINT,             -- situação padrão da qual esta herda (0/NULL = é padrão)
    cor                VARCHAR(20),        -- cor configurada no Bling (hex)
    id_modulo          BIGINT,             -- módulo do Bling (vendas = 98310 na conta da Barbers World)
    data_sincronizacao TIMESTAMPTZ NOT NULL
);

-- Nomes já conhecidos (catálogo real da conta, ver comentário em
-- dashboard/sql/rpc_dashboard_vendas.sql) — permitem o filtro funcionar antes do primeiro
-- sync. O sync sobrescreve com o que estiver no Bling.
INSERT INTO barbers.situacoes_pedido (id_situacao, nome, id_herdado, cor, id_modulo, data_sincronizacao)
VALUES
    (6,      'Em aberto',    0, NULL, 98310, now()),
    (9,      'Atendido',     0, NULL, 98310, now()),
    (12,     'Cancelado',    0, NULL, 98310, now()),
    (15,     'Em andamento', 0, NULL, 98310, now()),
    (453477, 'Devolução',    NULL, NULL, 98310, now())
ON CONFLICT (id_situacao) DO NOTHING;
