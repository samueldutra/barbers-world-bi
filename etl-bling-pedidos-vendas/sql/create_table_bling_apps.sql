-- App do Bling (client_id / client_secret) de cada conta, para clientes que criam o PRÓPRIO app.
-- Fica no schema public (config global), 1 linha por conta Bling (mesma chave de public.bling_oauth).
-- Sem linha para a conta = usa o app global (BLING_CLIENT_ID / BLING_CLIENT_SECRET / BLING_REDIRECT_URI).
-- O bling_oauth_bootstrap.py grava esta linha junto com os tokens.

CREATE TABLE IF NOT EXISTS public.bling_apps (
    conta         TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    redirect_uri  TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contém segredo: RLS ligada e sem políticas, e nenhum acesso para anon/authenticated.
-- Só o service_role (ETL e rotas de API do servidor) lê e grava.
ALTER TABLE public.bling_apps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bling_apps FROM PUBLIC, anon, authenticated;
