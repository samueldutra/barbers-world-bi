import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminClient } from '@/lib/supabase/admin'
import { autorizarModulo, lojaNuvemshop } from '@/lib/api/autorizar-modulo'
import { TENANT_SCHEMA } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

const schema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da marca.').max(100, 'O nome da marca é longo demais (máx. 100).'),
})

/** Cadastra uma marca na lista do BI. Na Nuvemshop a marca é só um texto do produto: ela passa a existir lá quando for
 * atribuída a algum produto (pela ação em massa). */
export async function POST(request: NextRequest) {
  const { erro } = await autorizarModulo('marca-categoria', 'Sem acesso ao módulo de marca e categoria.')
  if (erro) return erro

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.' }, { status: 400 })

  const loja = await lojaNuvemshop()
  if ('erro' in loja) return NextResponse.json({ error: loja.erro }, { status: 400 })

  const { data, error } = await getAdminClient().rpc('registrar_marca_nuvemshop', {
    p_schema_name: TENANT_SCHEMA, p_store_id: loja.storeId, p_nome: parsed.data.nome,
  })
  if (error) return NextResponse.json({ error: 'Não foi possível cadastrar a marca.' }, { status: 500 })
  if (data === 'ja_existe') return NextResponse.json({ error: `A marca "${parsed.data.nome}" já existe (maiúsculas e espaços não diferenciam).` }, { status: 409 })
  return NextResponse.json({ nome: parsed.data.nome.trim().replace(/\s+/g, ' ') })
}
