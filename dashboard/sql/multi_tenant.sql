-- Multi-tenant: um schema de dados por cliente (ex.: barbers, acme) no mesmo projeto Supabase.
--
-- Este arquivo cria o cadastro de tenants, a associação usuário x tenant, move a liberação de
-- módulos para o nível do tenant e define a função que TODA RPC chamada pelo app executa
-- antes de tocar no schema (public.assert_tenant_access). Sem essa checagem, qualquer usuário
-- logado poderia passar o schema de outro cliente em `p_schema_name`.
--
-- Idempotente. Ordem de aplicação (ver docs/multi-tenant.md):
--   1) este arquivo  2) rpc_*.sql (agora com a checagem)  3) deploy do frontend.
-- Seguro rodar com o frontend antigo no ar: o tenant 'barbers' é criado, todo usuário existente
-- vira membro dele e `tenant_id` tem DEFAULT = barbers até o frontend novo assumir.

-- 1) Tenants -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]*$'),
    nome        TEXT NOT NULL,
    -- Nome do schema com os dados do cliente. Entra em format(%I) nas RPCs: o CHECK impede
    -- qualquer caractere fora de [a-z0-9_].
    schema_name TEXT NOT NULL UNIQUE CHECK (schema_name ~ '^[a-z][a-z0-9_]*$'),
    -- Linha de public.bling_oauth usada por este cliente (1 conta Bling por tenant).
    conta_bling TEXT,
    logo_url    TEXT,
    ativo       BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- 2) Membros do tenant ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_users (
    user_id    UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    -- Admin do tenant: gere os usuários do próprio cliente (uso na tela de Usuários, fase 2).
    is_admin   BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS tenant_users_tenant_idx ON public.tenant_users (tenant_id);

ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;

-- Escrita só pelo service_role (rotas de API). Leitura: o usuário vê as próprias associações.
DROP POLICY IF EXISTS "tenant_users_select_own" ON public.tenant_users;
CREATE POLICY "tenant_users_select_own" ON public.tenant_users
    FOR SELECT USING (auth.uid() = user_id);

-- 3) Tenant inicial (Barbers World) e backfill ---------------------------------------------
INSERT INTO public.tenants (slug, nome, schema_name, conta_bling)
VALUES ('barbers', 'Barbers World', 'barbers', 'barbers')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.tenant_users (user_id, tenant_id)
SELECT up.id, t.id
FROM public.user_profiles up
CROSS JOIN public.tenants t
WHERE t.slug = 'barbers'
ON CONFLICT DO NOTHING;

-- 4) Módulos liberados passam a ser por (usuário, tenant) ----------------------------------
ALTER TABLE public.user_authorized_modules
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.user_authorized_modules
SET tenant_id = (SELECT id FROM public.tenants WHERE slug = 'barbers')
WHERE tenant_id IS NULL;

-- Enquanto o frontend antigo estiver no ar, ele insere sem tenant_id: o DEFAULT cobre.
-- Remover o default (ALTER COLUMN tenant_id DROP DEFAULT) depois do deploy do frontend novo.
DO $$
BEGIN
    EXECUTE format(
        'ALTER TABLE public.user_authorized_modules ALTER COLUMN tenant_id SET DEFAULT %L',
        (SELECT id FROM public.tenants WHERE slug = 'barbers')
    );
END $$;

ALTER TABLE public.user_authorized_modules ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.user_authorized_modules'::regclass
          AND conname = 'user_authorized_modules_pkey'
          AND array_length(conkey, 1) = 2
    ) THEN
        ALTER TABLE public.user_authorized_modules DROP CONSTRAINT user_authorized_modules_pkey;
        ALTER TABLE public.user_authorized_modules
            ADD CONSTRAINT user_authorized_modules_pkey PRIMARY KEY (user_id, tenant_id, module);
    END IF;
END $$;

-- 5) Checagem de acesso ao tenant ----------------------------------------------------------
-- Chamada no início de toda RPC que recebe p_schema_name / p_schema.
--  * schema precisa ser um tenant cadastrado e ativo (barra também qualquer nome malformado);
--  * service_role (ETL e rotas de API server-side) e o dono do banco (SQL Editor) passam;
--  * usuário logado precisa estar ativo e ser super admin da plataforma ou membro do tenant.
CREATE OR REPLACE FUNCTION public.assert_tenant_access(p_schema TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF p_schema IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.tenants t WHERE t.schema_name = p_schema AND t.ativo
    ) THEN
        RAISE EXCEPTION 'Tenant inválido ou inativo' USING ERRCODE = '42501';
    END IF;

    IF v_uid IS NULL THEN
        IF auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') THEN
            RETURN;
        END IF;
        RAISE EXCEPTION 'Acesso negado ao tenant' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.id = v_uid
          AND up.is_active
          AND (
              up.is_superadmin
              OR EXISTS (
                  SELECT 1
                  FROM public.tenant_users tu
                  JOIN public.tenants t ON t.id = tu.tenant_id
                  WHERE tu.user_id = v_uid AND t.schema_name = p_schema AND t.ativo
              )
          )
    ) THEN
        RETURN;
    END IF;

    RAISE EXCEPTION 'Acesso negado ao tenant' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.assert_tenant_access(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_tenant_access(TEXT) TO authenticated, service_role;

-- 6) Tenants do usuário logado (seletor de tenant e resolução do schema ativo) -------------
-- Super admin enxerga todos os tenants ativos; os demais, só aqueles de que são membros.
CREATE OR REPLACE FUNCTION public.meus_tenants()
RETURNS TABLE(id UUID, slug TEXT, nome TEXT, schema_name TEXT, logo_url TEXT, is_admin BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT t.id, t.slug, t.nome, t.schema_name, t.logo_url,
           COALESCE(tu.is_admin, false) AS is_admin
    FROM public.tenants t
    JOIN public.user_profiles up ON up.id = auth.uid() AND up.is_active
    LEFT JOIN public.tenant_users tu ON tu.tenant_id = t.id AND tu.user_id = up.id
    WHERE t.ativo AND (up.is_superadmin OR tu.user_id IS NOT NULL)
    ORDER BY t.nome;
$$;

REVOKE ALL ON FUNCTION public.meus_tenants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meus_tenants() TO authenticated, service_role;
