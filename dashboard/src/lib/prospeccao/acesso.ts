import type { SupabaseClient } from '@supabase/supabase-js'

/** Quem pode disparar o mapeamento de cidades (que gasta buscas no Google): conta ativa e
 * super admin ou com o módulo "prospeccao" liberado em Usuários — a mesma regra que o proxy
 * aplica às páginas de /prospeccao (as rotas /api/* ficam fora desse bloco). */
export async function usuarioPodeProspectar(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data: perfil } = await supabase
    .from('user_profiles')
    .select('is_superadmin, is_active')
    .eq('id', userId)
    .single()
  if (!perfil || perfil.is_active === false) return false
  if (perfil.is_superadmin === true) return true

  const { data: modulos } = await supabase
    .from('user_authorized_modules')
    .select('module')
    .eq('user_id', userId)
    .eq('module', 'prospeccao')
  return (modulos?.length ?? 0) > 0
}
