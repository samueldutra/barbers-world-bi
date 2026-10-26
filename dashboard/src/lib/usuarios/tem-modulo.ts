import type { SupabaseClient } from '@supabase/supabase-js'
import { tenantAtivoDaRequisicao } from '@/lib/tenant-server'

/** Conta ativa, com tenant ativo e (super admin ou módulo liberado em Usuários PARA ESSE TENANT). É a mesma regra que o proxy aplica
 * às páginas — as rotas /api/* ficam fora desse bloco, então cada uma confere sozinha, sobretudo
 * as que gastam dinheiro (Google Places, SerpApi). `supabase` é o cliente do USUÁRIO (cookies). */
export async function usuarioTemModulo(supabase: SupabaseClient, userId: string, modulo: string): Promise<boolean> {
  const { data: perfil } = await supabase
    .from('user_profiles')
    .select('is_superadmin, is_active')
    .eq('id', userId)
    .single()
  if (!perfil || perfil.is_active === false) return false
  const { ativo: tenant } = await tenantAtivoDaRequisicao(supabase)
  if (!tenant) return false
  if (perfil.is_superadmin === true) return true

  const { data: modulos } = await supabase
    .from('user_authorized_modules')
    .select('module')
    .eq('user_id', userId)
    .eq('tenant_id', tenant.id)
    .eq('module', modulo)
  return (modulos?.length ?? 0) > 0
}
