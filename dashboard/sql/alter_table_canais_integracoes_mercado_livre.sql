-- Canais de venda: adiciona o Mercado Livre em public.canais_integracoes.
-- O token do Mercado Livre expira em 6 h e o refresh_token é de uso único (cada renovação devolve um novo),
-- então guardamos também o refresh_token e quando o access_token vence. Mesmo acesso restrito (service_role).

ALTER TABLE public.canais_integracoes DROP CONSTRAINT IF EXISTS canais_integracoes_plataforma_check;
ALTER TABLE public.canais_integracoes
    ADD CONSTRAINT canais_integracoes_plataforma_check CHECK (plataforma IN ('nuvemshop', 'mercado-livre'));

ALTER TABLE public.canais_integracoes ADD COLUMN IF NOT EXISTS refresh_token TEXT;
ALTER TABLE public.canais_integracoes ADD COLUMN IF NOT EXISTS token_expira_em TIMESTAMPTZ;
