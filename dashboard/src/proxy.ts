import { updateSession } from '@/lib/supabase/middleware'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimiters, getClientIp, rateLimitHeaders } from '@/lib/security/rate-limit'

/** CSRF: valida que o Origin bate com o Host em requests que alteram estado. */
function validateCsrf(request: NextRequest): NextResponse | null {
  const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH']
  if (!mutatingMethods.includes(request.method)) return null

  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin) return null

  const originHost = new URL(origin).host
  if (originHost !== host) {
    console.warn('[CSRF] Bloqueado — origin diferente do host:', { origin, host, path: request.nextUrl.pathname })
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }
  return null
}

/** Rate limiting nas rotas de API, com limite mais estrito para /auth/. */
function checkApiRateLimit(request: NextRequest): NextResponse | null {
  if (!request.nextUrl.pathname.startsWith('/api/')) return null

  const clientIp = getClientIp(request.headers)
  const path = request.nextUrl.pathname

  const result = path.includes('/auth/') || path.includes('/users/create')
    ? rateLimiters.auth(`auth:${clientIp}`)
    : rateLimiters.standard(`api:${clientIp}`)

  if (!result.success) {
    console.warn('[RateLimit] Bloqueado:', { ip: clientIp, path, resetIn: result.resetIn })
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { ...rateLimitHeaders(result), 'Retry-After': String(result.resetIn) } }
    )
  }
  return null
}

export async function proxy(request: NextRequest) {
  const csrfError = validateCsrf(request)
  if (csrfError) return csrfError

  const rateLimitError = checkApiRateLimit(request)
  if (rateLimitError) return rateLimitError

  return await updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
