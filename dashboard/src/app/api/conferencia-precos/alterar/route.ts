import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { alterarPrecoProduto } from '@/lib/bling'
import { TENANT_SCHEMA } from '@/lib/tenant'

export const dynamic = 'force-dynamic'
// Cada lote tem no máximo MAX_ITENS_POR_LOTE produtos a ~2 req/s (limite do Bling é 3 req/s,
// compartilhado com o ETL) — a tela manda vários lotes pequenos e mostra o progresso.
export const maxDuration = 60

const MODULO = 'conferencia-precos'
const MAX_ITENS_POR_LOTE = 20
const INTERVALO_ENTRE_CHAMADAS_MS = 500

const schema = z.object({
  itens: z
    .array(
      z.object({
        id_produto: z.number().int().positive(),
        preco_anterior: z.number().nullable(),
        preco_novo: z.number().positive().max(1_000_000),
        origem: z.enum(['ultima_venda', 'manual']),
      })
    )
    .min(1)
    .max(MAX_ITENS_POR_LOTE),
})

/** Quem tem o módulo liberado (ou é super admin) pode alterar preço — mesma regra do
 * middleware pra página, repetida aqui porque /api/* não passa pela checagem de módulo. */
async function autorizar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { erro: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) }

  const { data: perfil } = await supabase
    .from('user_profiles')
    .select('is_superadmin, is_active')
    .eq('id', user.id)
    .single()
  if (!perfil?.is_active) return { erro: NextResponse.json({ error: 'Conta desativada.' }, { status: 403 }) }

  if (!perfil.is_superadmin) {
    const { data: liberado } = await supabase
      .from('user_authorized_modules')
      .select('module')
      .eq('user_id', user.id)
      .eq('module', MODULO)
      .maybeSingle()
    if (!liberado) {
      return { erro: NextResponse.json({ error: 'Sem acesso ao módulo de conferência de preços.' }, { status: 403 }) }
    }
  }
  return { erro: null, user }
}

export interface ResultadoAlteracao {
  id_produto: number
  sucesso: boolean
  erro: string | null
}

export async function POST(request: NextRequest) {
  const { erro, user } = await autorizar()
  if (erro) return erro

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }

  const admin = getAdminClient()
  const resultados: ResultadoAlteracao[] = []

  // Sequencial de propósito: respeita o rate limit do Bling e deixa cada item com seu
  // próprio resultado (um erro num produto não derruba os demais do lote).
  for (const [i, item] of parsed.data.itens.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, INTERVALO_ENTRE_CHAMADAS_MS))
    const precoNovo = Math.round(item.preco_novo * 100) / 100

    let mensagemErro: string | null = null
    try {
      await alterarPrecoProduto(item.id_produto, precoNovo)
    } catch (e) {
      mensagemErro = e instanceof Error ? e.message : 'Erro desconhecido ao alterar no Bling.'
    }

    const { error: erroRegistro } = await admin.rpc('registrar_alteracao_preco', {
      p_schema_name: TENANT_SCHEMA,
      p_id_produto: item.id_produto,
      p_preco_anterior: item.preco_anterior,
      p_preco_novo: precoNovo,
      p_origem: item.origem,
      p_sucesso: mensagemErro === null,
      p_erro: mensagemErro,
      p_usuario_id: user.id,
      p_usuario_email: user.email ?? null,
    })
    if (erroRegistro) {
      // O Bling já foi alterado (ou não) — a falha aqui é só no espelho/auditoria local; o
      // próximo sync da listagem corrige o preço em produtos.
      console.error('[conferencia-precos] Falha ao registrar alteração:', item.id_produto, erroRegistro)
    }

    resultados.push({ id_produto: item.id_produto, sucesso: mensagemErro === null, erro: mensagemErro })
  }

  return NextResponse.json({ resultados })
}
