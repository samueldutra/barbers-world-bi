import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const nextParam = searchParams.get('next') ?? '/dashboard'
  // Só aceita caminhos internos absolutos (evita open redirect: "//host", "https://host", "/\host")
  const next = /^\/(?![/\\])/.test(nextParam) ? nextParam : '/dashboard'
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  if (error) {
    const message = encodeURIComponent(errorDescription || error)
    return NextResponse.redirect(`${origin}/login?error=${message}`)
  }

  if (code) {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (!exchangeError) {
      const type = searchParams.get('type')
      if (type === 'email_change') {
        const message = encodeURIComponent('Alteração de email confirmada! Use seu novo email para fazer login.')
        return NextResponse.redirect(`${origin}/login?message=${message}`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }

    const message = encodeURIComponent('Erro ao confirmar. O link pode estar expirado.')
    return NextResponse.redirect(`${origin}/login?error=${message}`)
  }

  return NextResponse.redirect(`${origin}/login`)
}
