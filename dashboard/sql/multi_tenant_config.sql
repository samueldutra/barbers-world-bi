-- Multi-tenant: configuração do dashboard por cliente.
--
-- public.tenants.config (JSONB) guarda o que muda de um cliente para outro sem mudar o código:
--   abas        -> abas de canal do Dashboard. Lista de { id, label, grupo, situacoes_padrao? }:
--                  `grupo` = canais_venda.grupo do cliente, `situacoes_padrao` = ids de
--                  situacoes_pedido DO CLIENTE (os ids do Bling mudam de conta para conta).
--                  "Geral" sempre existe (o app a acrescenta); ausente = só a aba Geral.
--   status_lead -> quais classificações de lead o cliente usa, na ordem de exibição (o catálogo
--                  de rótulos e cores está em src/lib/leads-status.ts). Ausente = pendente,
--                  cliente, concorrente e lead.
-- public.meus_tenants() passa a devolver a config.

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::JSONB;

-- Barbers: configuração que estava fixa no código.
UPDATE public.tenants
SET config = jsonb_build_object(
    'abas', jsonb_build_array(
        jsonb_build_object('id', 'loja-fisica', 'label', 'Loja Física', 'grupo', 'Loja Física (PDV)'),
        jsonb_build_object('id', 'nuvemshop', 'label', 'Nuvemshop', 'grupo', 'Nuvemshop', 'situacoes_padrao', jsonb_build_array(9, 914897, 24, 6)),
        jsonb_build_object('id', 'mercado-livre', 'label', 'Mercado Livre', 'grupo', 'Mercado Livre', 'situacoes_padrao', jsonb_build_array(9, 914897, 24, 6)),
        jsonb_build_object('id', 'shopee', 'label', 'Shopee', 'grupo', 'Shopee', 'situacoes_padrao', jsonb_build_array(9, 914897, 24, 6)),
        jsonb_build_object('id', 'tiktok', 'label', 'TikTok Shop', 'grupo', 'TikTok', 'situacoes_padrao', jsonb_build_array(9, 914897, 24, 6))
    ),
    'status_lead', jsonb_build_array('pendente', 'cliente', 'concorrente', 'lead', 'cliente_bw', 'cliente_anderson', 'cliente_leo')
)
WHERE slug = 'barbers' AND config = '{}'::JSONB;

-- Mudou o tipo de retorno: precisa recriar a função.
DROP FUNCTION IF EXISTS public.meus_tenants();

CREATE FUNCTION public.meus_tenants()
RETURNS TABLE(id UUID, slug TEXT, nome TEXT, schema_name TEXT, conta_bling TEXT, logo_url TEXT, is_admin BOOLEAN, config JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT t.id, t.slug, t.nome, t.schema_name, t.conta_bling, t.logo_url,
           COALESCE(tu.is_admin, false) AS is_admin, t.config
    FROM public.tenants t
    JOIN public.user_profiles up ON up.id = auth.uid() AND up.is_active
    LEFT JOIN public.tenant_users tu ON tu.tenant_id = t.id AND tu.user_id = up.id
    WHERE t.ativo AND (up.is_superadmin OR tu.user_id IS NOT NULL)
    ORDER BY t.nome;
$$;

REVOKE ALL ON FUNCTION public.meus_tenants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meus_tenants() TO authenticated, service_role;
