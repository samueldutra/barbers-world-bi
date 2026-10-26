import type { SupabaseClient } from '@supabase/supabase-js'
import type { Tenant } from '@/lib/tenant'

/** Tenants a que o usuário do `supabase` (cliente com os cookies dele) tem acesso. O super admin
 * enxerga todos os ativos. A regra mora no banco (public.meus_tenants). */
export async function listarTenantsDoUsuario(supabase: SupabaseClient): Promise<Tenant[]> {
  const { data, error } = await supabase.rpc('meus_tenants')
  if (error) {
    console.error('[tenant] Erro ao listar tenants do usuário:', error)
    return []
  }
  return (data as Tenant[]) ?? []
}

/** Escolhe o tenant ativo: o do cookie, se o usuário ainda tiver acesso a ele; senão o primeiro.
 * Nunca confia no cookie sozinho. Aceita o slug direto para uso no proxy (que lê o cookie da
 * própria requisição). */
export async function resolverTenantAtivo(
  supabase: SupabaseClient,
  slugCookie: string | undefined | null
): Promise<{ ativo: Tenant | null; tenants: Tenant[] }> {
  const tenants = await listarTenantsDoUsuario(supabase)
  const ativo = tenants.find((t) => t.slug === slugCookie) ?? tenants[0] ?? null
  return { ativo, tenants }
}

