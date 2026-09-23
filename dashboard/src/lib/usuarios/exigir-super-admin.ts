import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Confere que quem está chamando é super admin ativo. Devolve a resposta de erro pronta
 * (ou null se pode seguir) — usado por todas as rotas de /api/usuarios. */
export async function exigirSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { erro: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }), user: null }
  }
  const { data: perfil } = await supabase
    .from('user_profiles')
    .select('is_superadmin, is_active')
    .eq('id', user.id)
    .single()
  if (!perfil?.is_superadmin || !perfil.is_active) {
    return { erro: NextResponse.json({ error: 'Só o super admin pode gerenciar usuários.' }, { status: 403 }), user: null }
  }
  return { erro: null, user }
}
