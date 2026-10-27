-- Multi-tenant, fase 2: canais de venda e conta do Bling por tenant.
-- Pré-requisito: sql/multi_tenant.sql aplicado. Idempotente.
--
-- 1) public.canais_integracoes (tokens Nuvemshop / Mercado Livre) ganha tenant_id. Antes, as rotas
--    de Canais de Venda e os ETLs liam as lojas de TODOS os clientes.
--    O DEFAULT = barbers cobre o frontend/ETL antigos até o deploy; remover depois:
--    ALTER TABLE public.canais_integracoes ALTER COLUMN tenant_id DROP DEFAULT;
-- 2) public.meus_tenants() passa a devolver conta_bling (linha de public.bling_oauth do cliente).

ALTER TABLE public.canais_integracoes
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.canais_integracoes
SET tenant_id = (SELECT id FROM public.tenants WHERE slug = 'barbers')
WHERE tenant_id IS NULL;

DO $$
BEGIN
    EXECUTE format(
        'ALTER TABLE public.canais_integracoes ALTER COLUMN tenant_id SET DEFAULT %L',
        (SELECT id FROM public.tenants WHERE slug = 'barbers')
    );
END $$;

ALTER TABLE public.canais_integracoes ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS canais_integracoes_tenant_idx ON public.canais_integracoes (tenant_id, plataforma, status);

-- Mudou o tipo de retorno: precisa recriar a função.
DROP FUNCTION IF EXISTS public.meus_tenants();

CREATE FUNCTION public.meus_tenants()
RETURNS TABLE(id UUID, slug TEXT, nome TEXT, schema_name TEXT, conta_bling TEXT, logo_url TEXT, is_admin BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT t.id, t.slug, t.nome, t.schema_name, t.conta_bling, t.logo_url,
           COALESCE(tu.is_admin, false) AS is_admin
    FROM public.tenants t
    JOIN public.user_profiles up ON up.id = auth.uid() AND up.is_active
    LEFT JOIN public.tenant_users tu ON tu.tenant_id = t.id AND tu.user_id = up.id
    WHERE t.ativo AND (up.is_superadmin OR tu.user_id IS NOT NULL)
    ORDER BY t.nome;
$$;

REVOKE ALL ON FUNCTION public.meus_tenants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meus_tenants() TO authenticated, service_role;
