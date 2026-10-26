import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { TENANT_COOKIE } from '@/lib/tenant'
import { resolverTenantAtivo } from '@/lib/tenant-resolver'

export { listarTenantsDoUsuario, resolverTenantAtivo } from '@/lib/tenant-resolver'

/** Para Server Components e rotas de API: tenant ativo da requisição atual. */
export async function tenantAtivoDaRequisicao(supabase: SupabaseClient) {
  const store = await cookies()
  return resolverTenantAtivo(supabase, store.get(TENANT_COOKIE)?.value)
}
