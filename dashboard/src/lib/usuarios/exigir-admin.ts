import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tenantAtivoDaRequisicao } from '@/lib/tenant-server'

/** Confere que quem chama é super admin da plataforma OU administrador do cliente ativo
 * (tenant_users.is_admin) e devolve o tenant ativo — a tela de Usuários gerencia os usuários dele.
 * Devolve a resposta de erro pronta (ou null se pode seguir). Usado por todas as rotas de /api/usuarios. */
export async function exigirAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { erro: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }), user: null, tenant: null, superAdmin: false }
  }
  const { data: perfil } = await supabase
    .from('user_profiles')
    .select('is_superadmin, is_active')
    .eq('id', user.id)
    .single()
  if (!perfil || !perfil.is_active) {
    return { erro: NextResponse.json({ error: 'Conta inativa.' }, { status: 403 }), user: null, tenant: null, superAdmin: false }
  }
  const { ativo: tenant } = await tenantAtivoDaRequisicao(supabase)
  if (!tenant) {
    return { erro: NextResponse.json({ error: 'Nenhum cliente ativo.' }, { status: 403 }), user: null, tenant: null, superAdmin: false }
  }
  const superAdmin = perfil.is_superadmin === true
  if (!superAdmin && !tenant.is_admin) {
    return { erro: NextResponse.json({ error: 'Só o administrador do cliente pode gerenciar usuários.' }, { status: 403 }), user: null, tenant: null, superAdmin: false }
  }
  return { erro: null, user, tenant, superAdmin }
}

/** Administrador de cliente (não super admin) só mexe em MEMBROS do cliente dele e nunca em super admin.
 * Devolve a resposta de erro, ou null se o alvo é permitido. Super admin passa direto. */
export async function exigirAlvoDoCliente(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  superAdmin: boolean,
  alvoId: string
) {
  if (superAdmin) return null
  const [{ data: membro }, { data: perfil }] = await Promise.all([
    admin.from('tenant_users').select('user_id').eq('tenant_id', tenantId).eq('user_id', alvoId).maybeSingle(),
    admin.from('user_profiles').select('is_superadmin').eq('id', alvoId).maybeSingle(),
  ])
  if (!membro || perfil?.is_superadmin) {
    return NextResponse.json({ error: 'Usuário não encontrado neste cliente.' }, { status: 404 })
  }
  return null
}
