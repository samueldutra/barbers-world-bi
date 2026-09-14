import { createClient, SupabaseClient } from '@supabase/supabase-js'

let adminClientInstance: SupabaseClient | null = null

/**
 * Cliente Supabase com service_role para operações administrativas.
 *
 * IMPORTANTE: bypassa RLS. Só usar em:
 * - Rotas de API server-side
 * - Operações que exigem privilégio elevado
 * - Nunca expor esse cliente ao browser
 */
export function createAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL não configurada')
  }
  if (!supabaseServiceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY não configurada. Necessária para operações admin — ' +
      'NÃO usar a NEXT_PUBLIC_SUPABASE_ANON_KEY como fallback.'
    )
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function getAdminClient(): SupabaseClient {
  if (!adminClientInstance) {
    adminClientInstance = createAdminClient()
  }
  return adminClientInstance
}
