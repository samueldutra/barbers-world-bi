import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { alterarCodigoProduto, buscarProduto } from '@/lib/bling'
import { TENANT_SCHEMA } from '@/lib/tenant'

export const dynamic = 'force-dynamic'
// Cada produto faz 3 chamadas ao Bling (ler, alterar, reler) a ~2 req/s; o limite do Bling (3 req/s) é
// compartilhado com o ETL — a tela manda lotes pequenos e mostra o progresso.
export const maxDuration = 60

const MODULO = 'vinculo-sku'
const MAX_ITENS_POR_LOTE = 8
const INTERVALO_ENTRE_CHAMADAS_MS = 450

const schema = z.object({
  itens: z.array(z.object({ id_produto: z.number().int().positive() })).min(1).max(MAX_ITENS_POR_LOTE),
})

/** Quem tem o módulo liberado (ou é super admin) — mesma regra do middleware pra página, repetida aqui
 * porque /api/* não passa pela checagem de módulo. */
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
      return { erro: NextResponse.json({ error: 'Sem acesso ao módulo de vínculo de SKU.' }, { status: 403 }) }
    }
  }
  return { erro: null, user }
}

export interface ResultadoAplicacaoSku {
  id_produto: number
  sucesso: boolean
  /** Código gravado e confirmado no Bling. */
  codigo_gravado: string | null
  erro: string | null
}

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toUpperCase()

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
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })

  const admin = getAdminClient()
  const itens = parsed.data.itens
  const resultados: ResultadoAplicacaoSku[] = []

  // Trava do teste: enquanto nenhuma aplicação tiver dado certo, só 1 produto por vez. Vale no servidor (a
  // tela só reflete) — a primeira gravação em massa no Bling precisa antes provar que a API aceita o campo.
  const { data: primeira } = await admin.rpc('validar_proposta_sku_bling', {
    p_schema_name: TENANT_SCHEMA,
    p_id_produto: itens[0].id_produto,
  })
  const aplicadosAteAgora = Number((Array.isArray(primeira) ? primeira[0] : primeira)?.aplicados ?? 0)
  if (aplicadosAteAgora === 0 && itens.length > 1) {
    return NextResponse.json(
      { error: 'Primeira aplicação: faça o teste com 1 produto só. Depois de uma aplicação confirmada o lote é liberado.' },
      { status: 409 }
    )
  }

  // Sequencial de propósito: respeita o limite do Bling e deixa cada item com seu próprio resultado.
  for (const [i, item] of itens.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, INTERVALO_ENTRE_CHAMADAS_MS))
    const pausa = () => new Promise((r) => setTimeout(r, INTERVALO_ENTRE_CHAMADAS_MS))

    let codigoGravado: string | null = null
    let mensagemErro: string | null = null
    let tocouNoBling = false

    try {
      // 1) A proposta existe, está liberada e o código não está em uso por outro produto.
      const { data: validacao, error: erroValidacao } = await admin.rpc('validar_proposta_sku_bling', {
        p_schema_name: TENANT_SCHEMA,
        p_id_produto: item.id_produto,
      })
      if (erroValidacao) throw new Error('Não foi possível validar a proposta. Tente de novo.')
      const v = Array.isArray(validacao) ? validacao[0] : validacao
      if (!v?.existe) throw new Error('Este produto não tem proposta de SKU.')
      if (!['pendente', 'erro'].includes(v.status)) throw new Error(`Proposta já está "${v.status}" — nada a fazer.`)
      if (v.situacao !== 'A') throw new Error('O produto não está ativo no Bling.')
      if (v.codigo_atual && String(v.codigo_atual).trim() !== '') {
        throw new Error(`O produto já tem código (${v.codigo_atual}) — esta tela só preenche produtos sem SKU.`)
      }
      if (v.qtd_outros_com_codigo > 0) throw new Error(`O código ${v.codigo_proposto} já existe em outro produto do Bling.`)
      const proposto = String(v.codigo_proposto)

      // 2) Confere NO BLING (os dados do BI podem estar atrasados): o produto continua sem código.
      const atual = await buscarProduto(item.id_produto)
      if (atual.codigo) throw new Error(`No Bling o produto já tem código (${atual.codigo}) — o BI estava desatualizado.`)
      await pausa()

      // 3) Grava só o código.
      tocouNoBling = true
      await alterarCodigoProduto(item.id_produto, proposto)
      await pausa()

      // 4) Relê e confirma. O Bling pode responder OK e ignorar o campo — sem esta conferência o teste não prova nada.
      const depois = await buscarProduto(item.id_produto)
      if (norm(depois.codigo) !== norm(proposto)) {
        throw new Error(
          `O Bling respondeu OK, mas o código não ficou gravado (lido de volta: ${depois.codigo ?? 'vazio'}). O campo pode não ser alterável por esta API.`
        )
      }
      codigoGravado = depois.codigo
    } catch (e) {
      mensagemErro = e instanceof Error ? e.message : 'Erro desconhecido ao gravar no Bling.'
    }

    const sucesso = mensagemErro === null
    const { error: erroRegistro } = await admin.rpc('registrar_aplicacao_sku_bling', {
      p_schema_name: TENANT_SCHEMA,
      p_id_produto: item.id_produto,
      p_sucesso: sucesso,
      p_erro: mensagemErro,
      p_usuario_id: user.id,
      p_usuario_email: user.email ?? null,
    })
    if (erroRegistro) {
      // O Bling já foi alterado (ou não) — a falha aqui é só no registro/espelho local; o próximo sync de
      // produtos corrige o código em barbers.produtos.
      console.error('[sku-bling] Falha ao registrar aplicação:', item.id_produto, erroRegistro, { tocouNoBling })
    }

    resultados.push({ id_produto: item.id_produto, sucesso, codigo_gravado: sucesso ? codigoGravado : null, erro: mensagemErro })
  }

  return NextResponse.json({ resultados })
}
