-- De/para de canais de venda: junta num só canal os pedidos de uma integração do Bling que
-- foi excluída e recriada (o Bling gera um loja.id novo e os pedidos antigos ficam
-- apontando pro id que não existe mais).
-- Execute substituindo "barbers" pelo schema do cliente, se for reusar para outro tenant.
--
-- Aplicado por trigger em pedidos_vendas (BEFORE INSERT/UPDATE): vale pro ETL e pra
-- qualquer outra carga, sem mexer em processar_carga_pedidos_vendas. Pra juntar outra
-- integração no futuro: inserir a linha aqui e rodar o UPDATE de backfill (fim do arquivo)
-- trocando os ids.
--
-- Consequência: nesses pedidos, pedidos_vendas.id_loja deixa de bater com o loja.id que o
-- Bling guarda — o id original fica registrado nesta tabela.

CREATE TABLE IF NOT EXISTS barbers.canais_venda_de_para (
    id_loja_origem   BIGINT PRIMARY KEY,   -- loja.id antigo (integração excluída no Bling)
    id_loja_destino  BIGINT NOT NULL,      -- loja.id que passa a valer no BI
    motivo           TEXT,
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (id_loja_origem <> id_loja_destino)
);

CREATE OR REPLACE FUNCTION barbers.aplicar_de_para_canal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.id_loja IS NOT NULL THEN
        NEW.id_loja := COALESCE(
            (SELECT d.id_loja_destino FROM barbers.canais_venda_de_para d
             WHERE d.id_loja_origem = NEW.id_loja),
            NEW.id_loja
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_vendas_de_para_canal ON barbers.pedidos_vendas;
CREATE TRIGGER trg_pedidos_vendas_de_para_canal
    BEFORE INSERT OR UPDATE OF id_loja ON barbers.pedidos_vendas
    FOR EACH ROW EXECUTE FUNCTION barbers.aplicar_de_para_canal();

-- Nuvemshop: integração excluída e recriada em 21/09/2026.
INSERT INTO barbers.canais_venda_de_para (id_loja_origem, id_loja_destino, motivo)
VALUES (205291049, 206304549, 'Integração Nuvemshop excluída e recriada no Bling em 2026-09-21')
ON CONFLICT (id_loja_origem) DO NOTHING;

-- Canal novo na dimensão (o sync de canais sobrescreve com o nome/tipo do Bling) e o antigo
-- marcado como desabilitado — não existe mais no Bling e fica sem pedidos após o backfill.
INSERT INTO barbers.canais_venda (id_loja, descricao, tipo, grupo, situacao, data_sincronizacao)
VALUES (206304549, 'LOJA SITE NUVEM SHOP', 'Nuvemshop', 'Nuvemshop', 1, now())
ON CONFLICT (id_loja) DO NOTHING;

UPDATE barbers.canais_venda SET situacao = 2 WHERE id_loja = 205291049;

-- Backfill: pedidos já carregados com o id antigo.
UPDATE barbers.pedidos_vendas p
SET id_loja = d.id_loja_destino
FROM barbers.canais_venda_de_para d
WHERE p.id_loja = d.id_loja_origem;
