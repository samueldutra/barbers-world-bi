import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MODULE_IDS } from '@/types/modules'

export const dynamic = 'force-dynamic'

async function exigirSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { erro: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) }
  }
  const { data: perfil } = await supabase
    .from('user_profiles')
    .select('is_superadmin')
    .eq('id', user.id)
    .single()
  if (!perfil?.is_superadmin) {
    return { erro: NextResponse.json({ error: 'Só o super admin pode gerenciar usuários.' }, { status: 403 }) }
  }
  return { erro: null, user }
}

/** true se `id` for o único super admin ativo — usado pra bloquear ações que deixariam
 * o sistema sem ninguém pra gerenciar usuários. */
async function ehUltimoSuperAdmin(admin: ReturnType<typeof createAdminClient>, id: string): Promise<boolean> {
  const { data } = await admin.from('user_profiles').select('id').eq('is_superadmin', true)
  const superAdmins = data ?? []
  return superAdmins.length === 1 && superAdmins[0].id === id
}

const atualizarUsuarioSchema = z.object({
  full_name: z.string().trim().min(1).optional(),
  is_superadmin: z.boolean().optional(),
  is_active: z.boolean().optional(),
  modules: z.array(z.string()).optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro, user } = await exigirSuperAdmin()
  if (erro) return erro

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  const parsed = atualizarUsuarioSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }
  const { full_name, is_superadmin, is_active, modules } = parsed.data

  const admin = createAdminClient()

  const removendoUltimoSuperAdmin =
    (is_superadmin === false || is_active === false) && (await ehUltimoSuperAdmin(admin, id))
  if (removendoUltimoSuperAdmin) {
    return NextResponse.json({ error: 'Não é possível remover o último super admin do sistema.' }, { status: 400 })
  }

  if (modules) {
    const modulosInvalidos = modules.filter((m) => !MODULE_IDS.includes(m))
    if (modulosInvalidos.length > 0) {
      return NextResponse.json({ error: `Módulo(s) inválido(s): ${modulosInvalidos.join(', ')}` }, { status: 400 })
    }
  }

  const dadosPerfil: Record<string, string | boolean> = {}
  if (full_name !== undefined) dadosPerfil.full_name = full_name
  if (is_superadmin !== undefined) dadosPerfil.is_superadmin = is_superadmin
  if (is_active !== undefined) dadosPerfil.is_active = is_active

  if (Object.keys(dadosPerfil).length > 0) {
    const { error } = await admin.from('user_profiles').update(dadosPerfil).eq('id', id)
    if (error) {
      console.error('Erro ao atualizar perfil:', error)
      return NextResponse.json({ error: 'Não foi possível atualizar o usuário.' }, { status: 500 })
    }
  }

  // Só mexe nos módulos se vieram no payload e o usuário não é (ou não está virando)
  // super admin — super admin ignora a tabela, não precisa de linha por módulo.
  const viraSuperAdmin = is_superadmin === true
  if (modules && !viraSuperAdmin) {
    const { error: deleteError } = await admin.from('user_authorized_modules').delete().eq('user_id', id)
    if (deleteError) {
      console.error('Erro ao limpar módulos antigos:', deleteError)
      return NextResponse.json({ error: 'Não foi possível atualizar os módulos.' }, { status: 500 })
    }
    if (modules.length > 0) {
      const { error: insertError } = await admin
        .from('user_authorized_modules')
        .insert(modules.map((module) => ({ user_id: id, module })))
      if (insertError) {
        console.error('Erro ao gravar novos módulos:', insertError)
        return NextResponse.json({ error: 'Não foi possível atualizar os módulos.' }, { status: 500 })
      }
    }
  }

  // Se o próprio super admin logado mudou algo em si mesmo (ex.: virou não-superadmin),
  // avisa o client pra recarregar sessão/perfil — tratado no hook, aqui só sinaliza.
  return NextResponse.json({ id, self: user?.id === id })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro, user } = await exigirSuperAdmin()
  if (erro) return erro

  const { id } = await params

  if (user?.id === id) {
    return NextResponse.json({ error: 'Você não pode excluir a própria conta.' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (await ehUltimoSuperAdmin(admin, id)) {
    return NextResponse.json({ error: 'Não é possível excluir o último super admin do sistema.' }, { status: 400 })
  }

  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) {
    console.error('Erro ao excluir usuário:', error)
    return NextResponse.json({ error: 'Não foi possível excluir o usuário.' }, { status: 500 })
  }

  return NextResponse.json({ id })
}
