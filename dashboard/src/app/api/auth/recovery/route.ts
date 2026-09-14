import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token = searchParams.get('token')
  const tokenHash = searchParams.get('token_hash')

  const recoveryToken = code || token || tokenHash

  if (!recoveryToken) {
    return NextResponse.redirect(`${origin}/recuperar-senha?error=Link inválido`)
  }

  const supabase = await createClient()

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(recoveryToken)

    if (!error && data.session) {
      return NextResponse.redirect(`${origin}/redefinir-senha`)
    }

    const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
      token_hash: recoveryToken,
      type: 'recovery',
    })

    if (!otpError && otpData.session) {
      return NextResponse.redirect(`${origin}/redefinir-senha`)
    }

    return NextResponse.redirect(`${origin}/recuperar-senha?error=Link expirado ou inválido. Solicite um novo.`)
  } catch (err) {
    console.error('[Recovery API] Erro inesperado:', err)
    return NextResponse.redirect(`${origin}/recuperar-senha?error=Erro ao processar link`)
  }
}
