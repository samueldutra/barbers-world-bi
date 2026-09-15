import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MODULE_IDS } from '@/types/modules'

export const dynamic = 'force-dynamic'

/** Confere que quem está chamando é super admin. Devolve a resposta de erro pronta (ou
 * null se pode seguir) — evita repetir a checagem em cada handler. */
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

  // Senha inicial aleatória e descartada — o usuário define a própria pelo fluxo de
  // "Esqueci minha senha" (o convite dispara esse email logo depois de criar a conta).
  const senhaInicial = randomBytes(24).toString('base64url')

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: senhaInicial,
    email_confirm: true,
    user_metadata: { full_name },
  })

  if (authError) {
    const msg = authError.message?.toLowerCase() ?? ''
    if (msg.includes('already') || msg.includes('registered') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'Já existe uma conta com esse email.' }, { status: 400 })
    }
    console.error('Erro ao criar usuário (auth):', authError)
    return NextResponse.json({ error: 'Não foi possível criar o usuário.' }, { status: 500 })
  }

  const novoId = authData.user.id

  const { error: perfilError } = await admin
    .from('user_profiles')
    .upsert({ id: novoId, full_name, is_superadmin, is_active: true }, { onConflict: 'id' })

  if (perfilError) {
    console.error('Erro ao gravar perfil do novo usuário:', perfilError)
    await admin.auth.admin.deleteUser(novoId)
    return NextResponse.json({ error: 'Não foi possível criar o usuário.' }, { status: 500 })
  }

  if (!is_superadmin && modules.length > 0) {
    const { error: modulosError } = await admin
      .from('user_authorized_modules')
      .insert(modules.map((module) => ({ user_id: novoId, module })))

    if (modulosError) {
      console.error('Erro ao gravar módulos do novo usuário:', modulosError)
      // Não desfaz a criação por causa disso — o super admin pode ajustar os módulos depois.
    }
  }

  return NextResponse.json({ id: novoId, email })
}
