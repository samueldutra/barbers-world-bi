import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { TENANT_COOKIE } from '@/lib/tenant'
import { listarTenantsDoUsuario } from '@/lib/tenant-server'

const corpoSchema = z.object({ slug: z.string().min(1).max(60) })

/** Troca o tenant ativo do usuário logado. Só aceita um tenant a que ele realmente tem acesso;
 * o cookie é só uma preferência e é revalidado em toda requisição. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const corpo = corpoSchema.safeParse(await request.json().catch(() => null))
  if (!corpo.success) return NextResponse.json({ error: 'Cliente inválido.' }, { status: 400 })

  const tenants = await listarTenantsDoUsuario(supabase)
  if (!tenants.some((t) => t.slug === corpo.data.slug)) {
    return NextResponse.json({ error: 'Sem acesso a esse cliente.' }, { status: 403 })
  }

  const resposta = NextResponse.json({ ok: true })
  resposta.cookies.set(TENANT_COOKIE, corpo.data.slug, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return resposta
}
