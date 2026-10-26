import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminClient } from '@/lib/supabase/admin'
import { alterarSkuVariante } from '@/lib/canais-integracao/nuvemshop'
import { autorizarModulo } from '@/lib/api/autorizar-modulo'

export const dynamic = 'force-dynamic'
// Lote pequeno a ~1,4 req/s (balde da Nuvemshop: 2/s) — a tela manda vários lotes e mostra o progresso.
export const maxDuration = 60

const MODULO = 'vinculo-sku'
const MAX_ITENS_POR_LOTE = 15
const INTERVALO_ENTRE_CHAMADAS_MS = 700

const schema = z.object({
  itens: z
    .array(
      z.object({
        store_id: z.number().int().positive(),
        id_produto_ns: z.number().int().positive(),
        id_variante: z.number().int().positive(),
        sku_anterior: z.string().max(100).nullable(),
        sku_novo: z.string().trim().min(1).max(100),
        origem: z.enum(['sugestao', 'manual', 'ajuste', 'escolha', 'pedidos']),
      })
    )
    .min(1)
    .max(MAX_ITENS_POR_LOTE),
})

export interface ResultadoAlteracaoSku {
  id_variante: number
  sucesso: boolean
  /** SKU efetivamente gravado (o código exato do Bling). */
  sku_gravado: string | null
  erro: string | null
}

export async function POST(request: NextRequest) {
  const { erro, user, tenant } = await autorizarModulo(MODULO, 'Sem acesso ao módulo de vínculo de SKU.')
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
  const resultados: ResultadoAlteracaoSku[] = []
  const tokens = new Map<number, string | null>() // store_id -> access_token
  const tenantId = tenant.id

  async function tokenDaLoja(storeId: number): Promise<string | null> {
    if (tokens.has(storeId)) return tokens.get(storeId) ?? null
    const { data } = await admin
      .from('canais_integracoes')
      .select('access_token')
      .eq('tenant_id', tenantId)
      .eq('plataforma', 'nuvemshop')
      .eq('status', 'conectado')
      .eq('store_id', String(storeId))
      .maybeSingle()
    const token = (data?.access_token as string | null | undefined) ?? null
    tokens.set(storeId, token)
    return token
  }

  // Sequencial de propósito: respeita o limite da Nuvemshop e deixa cada item com seu próprio resultado
  // (um erro numa variante não derruba as demais do lote).
  for (const [i, item] of parsed.data.itens.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, INTERVALO_ENTRE_CHAMADAS_MS))

    let skuGravado: string | null = null
    let idProdutoBling: number | null = null
    let mensagemErro: string | null = null

    try {
      // 1) O SKU precisa existir em exatamente 1 produto ativo do Bling (a fonte da verdade) e não pode
      //    já estar em outra variante da Nuvemshop (criaria duplicidade). Grava-se o código EXATO do Bling.
      const { data: validacao, error: erroValidacao } = await admin.rpc('validar_sku_vinculo_nuvemshop', {
        p_schema_name: tenant.schema_name,
        p_sku: item.sku_novo,
        p_id_variante: item.id_variante,
      })
      if (erroValidacao) throw new Error('Não foi possível validar o SKU no Bling. Tente de novo.')
      const v = Array.isArray(validacao) ? validacao[0] : validacao
      if (!v || v.qtd_bling === 0) throw new Error(`O SKU "${item.sku_novo}" não existe em nenhum produto ativo do Bling.`)
      if (v.qtd_bling > 1) throw new Error(`O SKU "${item.sku_novo}" está em ${v.qtd_bling} produtos do Bling — corrija a duplicidade lá antes.`)
      if (v.qtd_outras_variantes_ns > 0) throw new Error(`O SKU "${v.codigo_bling}" já é usado por outra variante da Nuvemshop.`)
      skuGravado = String(v.codigo_bling).trim()
      idProdutoBling = Number(v.id_produto_bling)

      // 2) Grava na Nuvemshop (só o SKU).
      const token = await tokenDaLoja(item.store_id)
      if (!token) throw new Error('Loja da Nuvemshop não conectada. Conecte em Canais de Venda.')
      await alterarSkuVariante(token, String(item.store_id), item.id_produto_ns, item.id_variante, skuGravado)
    } catch (e) {
      mensagemErro = e instanceof Error ? e.message : 'Erro desconhecido ao alterar na Nuvemshop.'
    }

    // Auditoria: toda tentativa fica registrada (sucesso, recusa da Nuvemshop ou recusa de validação), pra
    // saber quem tentou o quê.
    const sucesso = mensagemErro === null
    const { error: erroRegistro } = await admin.rpc('registrar_alteracao_sku_nuvemshop', {
      p_schema_name: tenant.schema_name,
      p_store_id: item.store_id,
      p_id_produto_ns: item.id_produto_ns,
      p_id_variante: item.id_variante,
      p_sku_anterior: item.sku_anterior,
      p_sku_novo: (skuGravado ?? item.sku_novo).slice(0, 100),
      p_id_produto_bling: idProdutoBling,
      p_origem: item.origem,
      p_sucesso: sucesso,
      p_erro: mensagemErro,
      p_usuario_id: user.id,
      p_usuario_email: user.email ?? null,
    })
    if (erroRegistro) {
      // A Nuvemshop já foi alterada (ou não) — a falha aqui é só no espelho/auditoria local; o próximo ETL
      // do catálogo corrige o SKU em nuvemshop_produtos.
      console.error('[vinculo-sku] Falha ao registrar alteração:', item.id_variante, erroRegistro)
    }

    resultados.push({ id_variante: item.id_variante, sucesso, sku_gravado: sucesso ? skuGravado : null, erro: mensagemErro })
  }

  return NextResponse.json({ resultados })
}
