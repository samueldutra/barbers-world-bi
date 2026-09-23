import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createImplicitClient, urlDefinirSenha } from '@/lib/supabase/links-acesso'

export const dynamic = 'force-dynamic'

const schema = z.object({ email: z.string().trim().toLowerCase().email() })

/** "Esqueci minha senha" pelo servidor, em fluxo implícito: o link do email funciona em
 * qualquer aparelho (antes, em PKCE, só no navegador onde a pessoa pediu). */
export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Email inválido.' }, { status: 400 })

  const { error } = await createImplicitClient().auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: urlDefinirSenha(request),
  })

  if (error) {
    const limite = error.status === 429 || error.message.toLowerCase().includes('rate limit')
    if (limite) {
      return NextResponse.json(
        { error: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.' },
        { status: 429 }
      )
    }
    // Não revela se o email existe ou não; só registra pra investigação.
    console.error('[recuperar-senha] Falha ao enviar email:', error)
  }
  return NextResponse.json({ ok: true })
}
