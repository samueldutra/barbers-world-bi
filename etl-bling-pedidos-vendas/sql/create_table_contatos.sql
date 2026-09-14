-- Dimensão de clientes (contatos do Bling que aparecem em pedidos_vendas).
-- Execute substituindo "barbers" pelo schema do cliente, se for reusar para outro tenant.

CREATE TABLE IF NOT EXISTS barbers.contatos (
    id_contato          BIGINT PRIMARY KEY,

    nome                 VARCHAR(200),
    fantasia             VARCHAR(200),
    tipo_pessoa           CHAR(1),          -- F, J, E
    documento             VARCHAR(20),       -- CPF/CNPJ
    situacao              CHAR(1),           -- A, E, I, S

    telefone              VARCHAR(30),
    celular               VARCHAR(30),
    email                 VARCHAR(200),

    endereco              VARCHAR(255),
    numero_endereco       VARCHAR(20),
    bairro                VARCHAR(100),
    municipio             VARCHAR(100),
    uf                    CHAR(2),
    cep                   VARCHAR(10),

    -- Controle
    data_sincronizacao    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contatos_documento
    ON barbers.contatos (documento);

CREATE INDEX IF NOT EXISTS idx_contatos_municipio_uf
    ON barbers.contatos (uf, municipio);
