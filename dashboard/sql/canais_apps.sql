-- Multi-tenant: app de Mercado Livre / Nuvemshop PRÓPRIO do cliente.
--
-- Por padrão todos os clientes usam o app da Barbers World (variáveis de ambiente MERCADOLIVRE_APP_ID/
-- MERCADOLIVRE_CLIENT_SECRET e NUVEMSHOP_APP_ID/NUVEMSHOP_CLIENT_SECRET). Um cliente com app próprio (ex.:
-- invento3d) ganha uma linha aqui; sem linha, vale o app global. Só o service_role lê (RLS sem policies) —
-- o client_secret nunca chega ao navegador.
--
-- Cadastro de um cliente (substitua os valores; redirect_uri é opcional e só informativo):
--   INSERT INTO public.canais_apps (tenant_id, plataforma, app_id, client_secret)
--   SELECT id, 'mercado-livre', '<APP_ID>', '<CLIENT_SECRET>' FROM public.tenants WHERE slug = 'invento3d'
--   ON CONFLICT (tenant_id, plataforma) DO UPDATE SET app_id = EXCLUDED.app_id,
--     client_secret = EXCLUDED.client_secret, updated_at = now();

CREATE TABLE IF NOT EXISTS public.canais_apps (
    tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    plataforma     TEXT NOT NULL CHECK (plataforma IN ('mercado-livre', 'nuvemshop')),
    app_id         TEXT NOT NULL,
    client_secret  TEXT NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, plataforma)
);

ALTER TABLE public.canais_apps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.canais_apps FROM PUBLIC, anon, authenticated;
