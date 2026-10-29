import { getAdminClient } from '@/lib/supabase/admin'

export interface AppCanal {
  appId: string | undefined
  clientSecret: string | undefined
}

/**
 * App (id + secret) da plataforma para o cliente: o próprio (public.canais_apps) ou, sem linha, o da Barbers World
 * vindo do ambiente (`global`). Só usar no servidor.
 */
export async function appDoTenant(tenantId: string, plataforma: 'mercado-livre' | 'nuvemshop', global: AppCanal): Promise<AppCanal> {
  const { data } = await getAdminClient()
    .from('canais_apps')
    .select('app_id, client_secret')
    .eq('tenant_id', tenantId)
    .eq('plataforma', plataforma)
    .maybeSingle()
  return { appId: data?.app_id || global.appId, clientSecret: data?.client_secret || global.clientSecret }
}
