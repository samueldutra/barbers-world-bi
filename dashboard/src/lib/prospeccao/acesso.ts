import type { SupabaseClient } from '@supabase/supabase-js'
import { usuarioTemModulo } from '@/lib/usuarios/tem-modulo'

/** Quem pode disparar o mapeamento de cidades e a busca de leads (gastam buscas no Google). */
export function usuarioPodeProspectar(supabase: SupabaseClient, userId: string): Promise<boolean> {
  return usuarioTemModulo(supabase, userId, 'prospeccao')
}
