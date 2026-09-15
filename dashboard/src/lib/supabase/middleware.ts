import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { SYSTEM_MODULES, moduleForPath } from '@/types/modules'

export async function updateSession(request: NextRequest) {
  // Supabase às vezes manda o code de recovery pra Site URL em vez do redirectTo.
  const code = request.nextUrl.searchParams.get('code')
  const isRootPath = request.nextUrl.pathname === '/'

  if (code && isRootPath && code.length > 10) {
    const url = request.nextUrl.clone()
    url.pathname = '/api/auth/recovery'
    return NextResponse.redirect(url)
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Sem cadastro público — contas só nascem pela tela de Usuários (super admin).
  const publicRoutes = ['/login', '/recuperar-senha', '/redefinir-senha']
  const isPublicRoute = publicRoutes.some((route) => request.nextUrl.pathname.startsWith(route))
  const isResetPasswordRoute = request.nextUrl.pathname.startsWith('/redefinir-senha')

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  let profile: { is_superadmin: boolean; is_active: boolean } | null = null
  if (user) {
    const { data } = await supabase
      .from('user_profiles')
      .select('is_superadmin, is_active')
      .eq('id', user.id)
      .single()
    profile = data as { is_superadmin: boolean; is_active: boolean } | null
  }

  // Conta desativada pelo super admin — encerra a sessão na hora.
  if (user && profile && !profile.is_active) {
    await supabase.auth.signOut()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('error', 'Conta desativada. Fale com o administrador.')
    return NextResponse.redirect(url)
  }

  const isSuper = profile?.is_superadmin === true
  const isAdminRoute = request.nextUrl.pathname.startsWith('/usuarios')

  if (user && isAdminRoute && !isSuper) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Módulos: quem não é super admin só entra no que foi liberado em Usuários. Rotas fora
  // de SYSTEM_MODULES (ex.: /usuarios, /sem-acesso, /api/*) não são pegas por esse bloco.
  if (user && profile && !isSuper && !isAdminRoute) {
    const modulo = moduleForPath(request.nextUrl.pathname)
    if (modulo) {
      const { data: autorizados } = await supabase
        .from('user_authorized_modules')
        .select('module')
        .eq('user_id', user.id)

      const idsAutorizados = new Set((autorizados ?? []).map((r) => r.module as string))

      if (!idsAutorizados.has(modulo.id)) {
        const url = request.nextUrl.clone()
        const primeiroLiberado = SYSTEM_MODULES.find((m) => idsAutorizados.has(m.id))
        url.pathname = primeiroLiberado ? primeiroLiberado.url : '/sem-acesso'
        url.search = ''
        return NextResponse.redirect(url)
      }
    }
  }

  if (user && isPublicRoute && !isResetPasswordRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
