import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminClient } from '@/lib/supabase/admin'
import { alterarPrecoProduto } from '@/lib/bling'
import { autorizarModulo } from '@/lib/api/autorizar-modulo'

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

export interface ResultadoAlteracao {
  id_produto: number
  sucesso: boolean
  erro: string | null
}

export async function POST(request: NextRequest) {
  const { erro, user, tenant } = await autorizarModulo(MODULO, 'Sem acesso ao módulo de conferência de preços.')
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
      p_schema_name: tenant.schema_name,
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
