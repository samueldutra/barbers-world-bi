import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { usuarioTemModulo } from '@/lib/usuarios/tem-modulo'

export const MODULO_CANAIS = 'canais-venda'

/** Usuário logado, ativo e com o módulo "Canais de venda" (ou super admin). */
export async function autorizarCanais() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { erro: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }), user: null }
  if (!(await usuarioTemModulo(supabase, user.id, MODULO_CANAIS))) {
    return { erro: NextResponse.json({ error: 'Sem acesso ao módulo Canais de venda.' }, { status: 403 }), user: null }
  }
  return { erro: null, user }
}
