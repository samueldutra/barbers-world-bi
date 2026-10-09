-- Módulo "Canais de venda": integrações com plataformas de e-commerce (primeira: Nuvemshop).
-- Fica no schema public (config global, como public.bling_oauth). Guarda o token da loja, então
-- o acesso é SÓ via service_role (rotas de API do Next) — RLS ligada e nenhuma policy: anon e
-- authenticated não leem nada. O frontend nunca recebe o token (a rota /api/canais-venda omite).

CREATE TABLE IF NOT EXISTS public.canais_integracoes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plataforma    TEXT NOT NULL CHECK (plataforma IN ('nuvemshop')),
    nome          TEXT NOT NULL,
    -- 'pendente' = cadastro criado, aguardando o lojista autorizar o app; 'conectado'; 'erro'.
    status        TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'conectado', 'erro')),
    -- Nuvemshop: valor aleatório enviado no `state` do OAuth, pra ligar o retorno ao cadastro.
    oauth_state   TEXT UNIQUE,
    -- Nuvemshop: user_id devolvido na troca do code = ID da loja (usado em /v1/{store_id}/...).
    store_id      TEXT,
    store_nome    TEXT,
    store_url     TEXT,
    access_token  TEXT,
    scope         TEXT,
    ultimo_erro   TEXT,
    criado_por    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    conectado_em  TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma loja só pode estar cadastrada uma vez por plataforma.
CREATE UNIQUE INDEX IF NOT EXISTS canais_integracoes_loja_uniq
    ON public.canais_integracoes (plataforma, store_id) WHERE store_id IS NOT NULL;

ALTER TABLE public.canais_integracoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.canais_integracoes FROM PUBLIC, anon, authenticated;
