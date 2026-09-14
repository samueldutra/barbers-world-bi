import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  const publicRoutes = ['/login', '/cadastro', '/recuperar-senha', '/redefinir-senha']
  const isPublicRoute = publicRoutes.some((route) => request.nextUrl.pathname.startsWith(route))
  const isResetPasswordRoute = request.nextUrl.pathname.startsWith('/redefinir-senha')

  const adminRoutes = ['/usuarios']
  const isAdminRoute = adminRoutes.some((route) => request.nextUrl.pathname.startsWith(route))

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  let profile: { role: string } | null = null
  if (user) {
    const { data } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    profile = data as { role: string } | null
  }

  if (user && isAdminRoute && (!profile || !['superadmin', 'admin'].includes(profile.role))) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  if (user && isPublicRoute && !isResetPasswordRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
