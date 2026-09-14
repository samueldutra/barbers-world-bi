-- Tabela de controle dos tokens OAuth do Bling (fonte de verdade).
-- Fica no schema public (config global), 1 linha por conta Bling.
-- O bootstrap grava a primeira vez; o ETL lê, dá refresh e regrava.

CREATE TABLE IF NOT EXISTS public.bling_oauth (
    conta         TEXT PRIMARY KEY,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sem RLS: acesso só via service_role (server-side). Não expor via anon key.
ALTER TABLE public.bling_oauth ENABLE ROW LEVEL SECURITY;
