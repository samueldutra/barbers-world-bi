import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminClient } from '@/lib/supabase/admin'
import { criarCategoriaNuvemshop } from '@/lib/canais-integracao/nuvemshop'
import { autorizarModulo, lojaNuvemshop } from '@/lib/api/autorizar-modulo'
import { TENANT_SCHEMA } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

const schema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da categoria.').max(100, 'O nome da categoria é longo demais (máx. 100).'),
  /** Categoria pai; null/ausente = categoria de topo. */
  id_pai: z.number().int().positive().nullable().optional(),
})

const normalizar = (t: string) => t.trim().replace(/\s+/g, ' ').toUpperCase()

/** Cria uma categoria na Nuvemshop e a reflete no banco (aparece na lista na hora). */
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
  const { nome, id_pai: idPai = null } = parsed.data

  const loja = await lojaNuvemshop()
  if ('erro' in loja) return NextResponse.json({ error: loja.erro }, { status: 400 })

  const admin = getAdminClient()
  // Não cria duplicada (mesmo nome sob o mesmo pai) nem sob um pai que não existe.
  const { data: existentes, error: erroLista } = await admin.rpc('obter_categorias_nuvemshop', { p_schema_name: TENANT_SCHEMA })
  if (erroLista) return NextResponse.json({ error: 'Não foi possível conferir as categorias existentes.' }, { status: 500 })
  const lista = (existentes ?? []) as { id_categoria: number; nome: string; id_pai: number | null }[]
  if (idPai !== null && !lista.some((c) => Number(c.id_categoria) === idPai)) {
    return NextResponse.json({ error: 'A categoria pai escolhida não existe mais. Atualize os dados.' }, { status: 400 })
  }
  if (lista.some((c) => (c.id_pai === null ? null : Number(c.id_pai)) === idPai && normalizar(c.nome) === normalizar(nome))) {
    return NextResponse.json({ error: `Já existe uma categoria "${nome}" neste nível.` }, { status: 409 })
  }

  try {
    const criada = await criarCategoriaNuvemshop(loja.token, String(loja.storeId), nome, idPai)
    const { error: erroEspelho } = await admin.rpc('registrar_categoria_nuvemshop', {
      p_schema_name: TENANT_SCHEMA, p_store_id: loja.storeId, p_id_categoria: criada.id, p_nome: criada.nome, p_id_pai: criada.idPai,
    })
    // A categoria já existe na Nuvemshop; se o espelho falhar, o próximo ETL do catálogo a traz.
    if (erroEspelho) console.error('[marca-categoria] Falha ao espelhar a categoria criada:', criada.id, erroEspelho)
    return NextResponse.json({ id: criada.id, nome: criada.nome, id_pai: criada.idPai })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro ao criar a categoria na Nuvemshop.' }, { status: 502 })
  }
}
