-- Canais de venda: adiciona a Shopee em public.canais_integracoes e em public.canais_apps.
-- Shopee: store_id = shop_id; access_token vale 4 h; refresh_token vale 30 dias e cada renovação devolve um novo
-- (guardar sempre o par mais recente); a AUTORIZAÇÃO do lojista vale no máx. 365 dias (autorizacao_expira_em) e, vencida,
-- o lojista precisa autorizar de novo. Em canais_apps: app_id = partner_id, client_secret = partner_key.

ALTER TABLE public.canais_integracoes DROP CONSTRAINT IF EXISTS canais_integracoes_plataforma_check;
ALTER TABLE public.canais_integracoes
    ADD CONSTRAINT canais_integracoes_plataforma_check CHECK (plataforma IN ('nuvemshop', 'mercado-livre', 'shopee'));

ALTER TABLE public.canais_integracoes ADD COLUMN IF NOT EXISTS autorizacao_expira_em TIMESTAMPTZ;

ALTER TABLE public.canais_apps DROP CONSTRAINT IF EXISTS canais_apps_plataforma_check;
ALTER TABLE public.canais_apps
    ADD CONSTRAINT canais_apps_plataforma_check CHECK (plataforma IN ('mercado-livre', 'nuvemshop', 'shopee'));

-- App Shopee de um cliente (ex.: invento3d). Use a partner_key de PRODUÇÃO (a do sandbox é outra):
--   INSERT INTO public.canais_apps (tenant_id, plataforma, app_id, client_secret)
--   SELECT id, 'shopee', '<PARTNER_ID>', '<PARTNER_KEY>' FROM public.tenants WHERE slug = 'invento3d'
--   ON CONFLICT (tenant_id, plataforma) DO UPDATE SET app_id = EXCLUDED.app_id,
--     client_secret = EXCLUDED.client_secret, updated_at = now();
