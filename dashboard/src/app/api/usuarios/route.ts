import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirSuperAdmin } from '@/lib/usuarios/exigir-super-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { MODULE_IDS } from '@/types/modules'
import { mensagemErroEmail, urlDefinirSenha } from '@/lib/supabase/links-acesso'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { erro } = await exigirSuperAdmin()
  if (erro) return erro

  const admin = createAdminClient()

  const [{ data: perfis, error: perfisError }, { data: modulos, error: modulosError }, { data: authData, error: authError }] =
    await Promise.all([
      admin.from('user_profiles').select('id, full_name, is_superadmin, is_active, created_at').order('created_at', { ascending: false }),
      admin.from('user_authorized_modules').select('user_id, module'),
      admin.auth.admin.listUsers({ perPage: 1000 }),
    ])

  if (perfisError || modulosError || authError) {
    console.error('Erro ao listar usuários:', perfisError ?? modulosError ?? authError)
    return NextResponse.json({ error: 'Não foi possível listar os usuários.' }, { status: 500 })
  }

  const emailPorId = new Map(authData.users.map((u) => [u.id, u.email ?? '']))
  // Situação do acesso — mostra quem ainda não entrou pela primeira vez (convite pendente).
  const acessoPorId = new Map(
    authData.users.map((u) => [
      u.id,
      {
        ultimo_acesso: u.last_sign_in_at ?? null,
        convite_pendente: !u.email_confirmed_at || !u.last_sign_in_at,
      },
    ])
  )
  const modulosPorId = new Map<string, string[]>()
  for (const m of modulos ?? []) {
    const lista = modulosPorId.get(m.user_id) ?? []
    lista.push(m.module)
    modulosPorId.set(m.user_id, lista)
  }

  const usuarios = (perfis ?? []).map((p) => ({
    id: p.id,
    email: emailPorId.get(p.id) ?? '',
    full_name: p.full_name,
    is_superadmin: p.is_superadmin,
    is_active: p.is_active,
    created_at: p.created_at,
    ...acessoPorId.get(p.id),
    modules: p.is_superadmin ? MODULE_IDS : (modulosPorId.get(p.id) ?? []),
  }))

  return NextResponse.json({ usuarios })
}

const criarUsuarioSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  full_name: z.string().trim().min(1),
  is_superadmin: z.boolean(),
  modules: z.array(z.string()),
})

function emailJaCadastrado(err: { message?: string; code?: string } | null): boolean {
  const msg = err?.message?.toLowerCase() ?? ''
  return err?.code === 'email_exists' || msg.includes('already') || msg.includes('registered')
}

/**
 * Cria o usuário e manda o convite pra ele definir a senha.
 *
 * O convite sai daqui (servidor, fluxo implícito) — antes era disparado pelo navegador do
 * super admin em fluxo PKCE, e o link só funcionava no navegador do próprio admin (ver
 * src/lib/supabase/links-acesso.ts). Se o Supabase não conseguir mandar o email (limite de
 * envio, SMTP), o usuário é criado do mesmo jeito e a resposta traz um link de acesso pro
 * admin enviar por outro canal.
 */
export async function POST(request: NextRequest) {
  const { erro } = await exigirSuperAdmin()
  if (erro) return erro

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  const parsed = criarUsuarioSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }
  const { email, full_name, is_superadmin, modules } = parsed.data

  const modulosInvalidos = modules.filter((m) => !MODULE_IDS.includes(m))
  if (modulosInvalidos.length > 0) {
    return NextResponse.json({ error: `Módulo(s) inválido(s): ${modulosInvalidos.join(', ')}` }, { status: 400 })
  }
  if (!is_superadmin && modules.length === 0) {
    return NextResponse.json({ error: 'Selecione ao menos um módulo (ou marque como super admin).' }, { status: 400 })
  }

  const admin = createAdminClient()
  const redirectTo = urlDefinirSenha(request)

  let novoId: string
  let emailEnviado = true
  let erroEmail: string | null = null
  let linkAcesso: string | null = null

  const convite = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo })
  if (convite.error) {
    if (emailJaCadastrado(convite.error)) {
      return NextResponse.json({ error: 'Já existe uma conta com esse email.' }, { status: 400 })
    }
    // Email não saiu: cria pelo generateLink (não envia nada) e devolve o link pro admin.
    console.warn('[usuarios] Convite por email falhou, gerando link manual:', convite.error.message)
    emailEnviado = false
    erroEmail = mensagemErroEmail(convite.error)
    const gerado = await admin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { data: { full_name }, redirectTo },
    })
    if (gerado.error || !gerado.data.user) {
      if (emailJaCadastrado(gerado.error)) {
        return NextResponse.json({ error: 'Já existe uma conta com esse email.' }, { status: 400 })
      }
      console.error('[usuarios] Erro ao criar usuário (generateLink):', gerado.error)
      return NextResponse.json({ error: 'Não foi possível criar o usuário.' }, { status: 500 })
    }
    novoId = gerado.data.user.id
    linkAcesso = gerado.data.properties.action_link
  } else {
    novoId = convite.data.user.id
  }

  // Criação é tudo-ou-nada: se perfil ou módulos falharem, apaga a conta recém-criada pra
  // não sobrar usuário "meio cadastrado" (sem módulos, sem acesso a nada).
  const desfazer = async (motivo: string, detalhe: unknown) => {
    console.error(`[usuarios] ${motivo}:`, detalhe)
    await admin.auth.admin.deleteUser(novoId)
    return NextResponse.json({ error: 'Não foi possível criar o usuário.' }, { status: 500 })
  }

  const { error: perfilError } = await admin
    .from('user_profiles')
    .upsert({ id: novoId, full_name, is_superadmin, is_active: true }, { onConflict: 'id' })
  if (perfilError) return desfazer('Erro ao gravar perfil do novo usuário', perfilError)

  if (!is_superadmin && modules.length > 0) {
    const { error: modulosError } = await admin
      .from('user_authorized_modules')
      .insert(modules.map((module) => ({ user_id: novoId, module })))
    if (modulosError) return desfazer('Erro ao gravar módulos do novo usuário', modulosError)
  }

  return NextResponse.json({ id: novoId, email, emailEnviado, erroEmail, linkAcesso })
}
