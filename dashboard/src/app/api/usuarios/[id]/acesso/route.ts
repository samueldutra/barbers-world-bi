import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createImplicitClient, mensagemErroEmail, urlDefinirSenha } from '@/lib/supabase/links-acesso'
import { exigirSuperAdmin } from '@/lib/usuarios/exigir-super-admin'

export const dynamic = 'force-dynamic'

const schema = z.object({ enviar_email: z.boolean() })

/**
 * Novo acesso pra um usuário existente: quem ainda não aceitou o convite recebe um convite
 * novo; quem já tem conta recebe um link de redefinir senha.
 * - enviar_email=false → devolve o link pro admin copiar/mandar por WhatsApp (não depende
 *   do envio de email do Supabase, que tem limite baixo).
 * - enviar_email=true  → o Supabase manda o email.
 * Ambos em fluxo implícito: funcionam em qualquer aparelho (ver lib/supabase/links-acesso.ts).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirSuperAdmin()
  if (erro) return erro

  const { id } = await params
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.getUserById(id)
  if (error || !data.user?.email) {
    return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 })
  }
  const { email, email_confirmed_at, user_metadata } = data.user
  const convitePendente = !email_confirmed_at
  const redirectTo = urlDefinirSenha(request)

  if (parsed.data.enviar_email) {
    const { error: erroEnvio } = convitePendente
      ? await admin.auth.admin.inviteUserByEmail(email, { data: user_metadata, redirectTo })
      : await createImplicitClient().auth.resetPasswordForEmail(email, { redirectTo })
    if (erroEnvio) {
      console.error('[usuarios/acesso] Falha ao enviar email:', erroEnvio)
      return NextResponse.json({ error: mensagemErroEmail(erroEnvio) }, { status: 502 })
    }
    return NextResponse.json({ emailEnviado: true, link: null })
  }

  const gerado = await admin.auth.admin.generateLink({
    type: convitePendente ? 'invite' : 'recovery',
    email,
    options: { redirectTo },
  })
  if (gerado.error) {
    console.error('[usuarios/acesso] Falha ao gerar link:', gerado.error)
    return NextResponse.json({ error: 'Não foi possível gerar o link de acesso.' }, { status: 500 })
  }
  return NextResponse.json({ emailEnviado: false, link: gerado.data.properties.action_link })
}
