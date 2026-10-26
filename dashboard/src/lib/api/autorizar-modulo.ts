import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import type { Tenant } from '@/lib/tenant'
import { tenantAtivoDaRequisicao } from '@/lib/tenant-server'

/** Quem tem o módulo liberado NO TENANT ATIVO (ou é super admin) pode usar a rota — a mesma regra do middleware pra
 * página, repetida aqui porque /api/* não passa pela checagem de módulo. Devolve também o tenant ativo
 * (`tenant.schema_name` vai em `p_schema_name`). */
export async function autorizarModulo(
  modulo: string,
  mensagemSemAcesso: string
): Promise<{ erro: NextResponse; user: null; tenant: null } | { erro: null; user: User; tenant: Tenant }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { erro: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }), user: null, tenant: null }

  const { data: perfil } = await supabase
    .from('user_profiles')
    .select('is_superadmin, is_active')
    .eq('id', user.id)
    .single()
  if (!perfil?.is_active) {
    return { erro: NextResponse.json({ error: 'Conta desativada.' }, { status: 403 }), user: null, tenant: null }
  }

  const { ativo: tenant } = await tenantAtivoDaRequisicao(supabase)
  if (!tenant) {
    return { erro: NextResponse.json({ error: 'Nenhum cliente liberado para esta conta.' }, { status: 403 }), user: null, tenant: null }
  }

  if (!perfil.is_superadmin) {
    const { data: liberado } = await supabase
      .from('user_authorized_modules')
      .select('module')
      .eq('user_id', user.id)
      .eq('tenant_id', tenant.id)
      .eq('module', modulo)
      .maybeSingle()
    if (!liberado) {
      return { erro: NextResponse.json({ error: mensagemSemAcesso }, { status: 403 }), user: null, tenant: null }
    }
  }
  return { erro: null, user, tenant }
}

/** Token e id da loja Nuvemshop conectada DO TENANT. Com `storeId`, a loja pedida; sem, a única conectada (erro se houver 0 ou 2+). */
export async function lojaNuvemshop(tenantId: string, storeId?: number): Promise<{ storeId: number; token: string } | { erro: string }> {
  const admin = getAdminClient()
  let consulta = admin
    .from('canais_integracoes')
    .select('store_id, access_token')
    .eq('tenant_id', tenantId)
    .eq('plataforma', 'nuvemshop')
    .eq('status', 'conectado')
  if (storeId !== undefined) consulta = consulta.eq('store_id', String(storeId))
  const { data } = await consulta
  const lojas = (data ?? []).filter((l) => l.access_token)
  if (lojas.length === 0) return { erro: 'Loja da Nuvemshop não conectada. Conecte em Canais de Venda.' }
  if (lojas.length > 1) return { erro: 'Há mais de uma loja da Nuvemshop conectada — não foi possível escolher qual usar.' }
  return { storeId: Number(lojas[0].store_id), token: lojas[0].access_token as string }
}
