import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { getAdminClient } from '@/lib/supabase/admin'
import { autorizarCanais } from '@/lib/canais-integracao/autorizar'
import { configFaltando, configNuvemshop, urlAutorizacao } from '@/lib/canais-integracao/nuvemshop'

export const dynamic = 'force-dynamic'

/** Colunas devolvidas ao navegador — NUNCA inclui access_token nem oauth_state. */
const COLUNAS_PUBLICAS =
  'id, plataforma, nome, status, store_id, store_nome, store_url, scope, ultimo_erro, created_at, conectado_em'

/** Lista os canais cadastrados + o que falta configurar no servidor pra integrar. */
export async function GET() {
  const { erro } = await autorizarCanais()
  if (erro) return erro

  const { data, error } = await getAdminClient()
    .from('canais_integracoes')
    .select(COLUNAS_PUBLICAS)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const config = configNuvemshop()
  return NextResponse.json({
    canais: data ?? [],
    nuvemshop: { faltando: configFaltando(config), redirectUri: config.redirectUri ?? null },
  })
}

const schema = z.object({
  plataforma: z.enum(['nuvemshop']),
  nome: z.string().trim().min(2, 'Dê um nome ao canal.').max(80),
})

/** Cadastra o canal (status "pendente") e devolve a URL pra o lojista autorizar o app. */
export async function POST(request: NextRequest) {
  const { erro, user } = await autorizarCanais()
  if (erro) return erro

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 })
  }

  const config = configNuvemshop()
  const faltando = configFaltando(config)
  if (faltando.length > 0 || !config.appId) {
    return NextResponse.json(
      { error: `Falta configurar no servidor: ${faltando.join(', ')}.`, faltando },
      { status: 409 }
    )
  }

  const state = randomBytes(24).toString('hex')
  const { data, error } = await getAdminClient()
    .from('canais_integracoes')
    .insert({ plataforma: parsed.data.plataforma, nome: parsed.data.nome, oauth_state: state, criado_por: user!.id })
    .select(COLUNAS_PUBLICAS)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ canal: data, urlAutorizacao: urlAutorizacao(config.appId, state) }, { status: 201 })
}
