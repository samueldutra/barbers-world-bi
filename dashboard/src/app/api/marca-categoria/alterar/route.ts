import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminClient } from '@/lib/supabase/admin'
import { alterarMarcaCategoriasProduto, buscarMarcaCategoriasProduto } from '@/lib/canais-integracao/nuvemshop'
import { autorizarModulo, lojaNuvemshop } from '@/lib/api/autorizar-modulo'
import { TENANT_SCHEMA } from '@/lib/tenant'

export const dynamic = 'force-dynamic'
// Lote pequeno (cada produto = 1 leitura + 1 gravação, ~1,4 req/s no balde da Nuvemshop): a tela manda vários lotes
// e mostra o progresso.
export const maxDuration = 60

const MODULO = 'marca-categoria'
const MAX_ITENS_POR_LOTE = 15
const INTERVALO_ENTRE_CHAMADAS_MS = 700

const schema = z
  .object({
    itens: z.array(z.object({ store_id: z.number().int().positive(), id_produto_ns: z.number().int().positive() })).min(1).max(MAX_ITENS_POR_LOTE),
    marca: z
      .discriminatedUnion('acao', [
        z.object({ acao: z.literal('definir'), valor: z.string().trim().min(1).max(100) }),
        z.object({ acao: z.literal('limpar') }),
      ])
      .optional(),
    categorias: z
      .object({
        acao: z.enum(['adicionar', 'substituir', 'remover', 'limpar']),
        ids: z.array(z.number().int().positive()).max(50).default([]),
      })
      .optional(),
  })
  .refine((v) => v.marca !== undefined || v.categorias !== undefined, { message: 'Nada para alterar.' })
  .refine((v) => !v.categorias || v.categorias.acao === 'limpar' || v.categorias.ids.length > 0, { message: 'Escolha ao menos uma categoria.' })

export interface ResultadoMarcaCategoria {
  id_produto_ns: number
  sucesso: boolean
  /** false = o produto já estava assim (nada foi enviado à Nuvemshop). */
  alterado: boolean
  marca: string | null
  categorias_ids: number[]
  erro: string | null
}

const normalizar = (t: string | null) => (t ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
const mesmoConjunto = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x))

/** A Nuvemshop acrescenta sozinha as categorias PAI de uma subcategoria atribuída (ex.: ao dar "GOLAS HIGIÊNICAS" o produto
 * fica também com "ACESSÓRIOS DESCARTÁVEIS" e "ACESSÓRIOS"). Por isso a conferência aceita o que foi pedido MAIS os ancestrais. */
function ancestrais(ids: number[], paiDe: Map<number, number | null>): Set<number> {
  const resultado = new Set<number>()
  for (const id of ids) {
    let atual = paiDe.get(id) ?? null
    for (let nivel = 0; atual !== null && !resultado.has(atual) && nivel < 10; nivel++) {
      resultado.add(atual)
      atual = paiDe.get(atual) ?? null
    }
  }
  return resultado
}

/** Pedido ⊆ gravado ⊆ pedido + ancestrais. Pedido vazio exige gravado vazio. */
function categoriasConferem(pedido: number[], gravado: number[], paiDe: Map<number, number | null>): boolean {
  if (pedido.length === 0) return gravado.length === 0
  const permitido = new Set([...pedido, ...ancestrais(pedido, paiDe)])
  return pedido.every((id) => gravado.includes(id)) && gravado.every((id) => permitido.has(id))
}

export async function POST(request: NextRequest) {
  const { erro, user } = await autorizarModulo(MODULO, 'Sem acesso ao módulo de marca e categoria.')
  if (erro) return erro

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Dados inválidos.' }, { status: 400 })
  const { itens, marca, categorias } = parsed.data

  const admin = getAdminClient()
  const lojas = new Map<number, { token: string } | { erro: string }>()
  async function lojaDe(storeId: number) {
    if (!lojas.has(storeId)) {
      const l = await lojaNuvemshop(storeId)
      lojas.set(storeId, 'erro' in l ? { erro: l.erro } : { token: l.token })
    }
    return lojas.get(storeId)!
  }

  // As categorias escolhidas precisam existir no cadastro da loja (senão a Nuvemshop ignora ou recusa o id).
  const idsEscolhidos = categorias && categorias.acao !== 'limpar' ? [...new Set(categorias.ids)] : []
  let categoriasInvalidas: number[] = []
  if (idsEscolhidos.length > 0) {
    for (const storeId of new Set(itens.map((i) => i.store_id))) {
      const { data } = await admin.rpc('categorias_inexistentes_nuvemshop', {
        p_schema_name: TENANT_SCHEMA, p_store_id: storeId, p_ids: idsEscolhidos,
      })
      categoriasInvalidas = categoriasInvalidas.concat((data as number[] | null) ?? [])
    }
  }

  const paiDe = new Map<number, number | null>()
  if (categorias) {
    const { data: lista } = await admin.rpc('obter_categorias_nuvemshop', { p_schema_name: TENANT_SCHEMA })
    for (const c of (lista ?? []) as { id_categoria: number; id_pai: number | null }[]) {
      paiDe.set(Number(c.id_categoria), c.id_pai === null ? null : Number(c.id_pai))
    }
  }

  const resultados: ResultadoMarcaCategoria[] = []
  // Sequencial de propósito: respeita o limite da Nuvemshop e dá a cada produto o seu resultado (um erro não derruba o lote).
  for (const [i, item] of itens.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, INTERVALO_ENTRE_CHAMADAS_MS))

    let anterior: { marca: string | null; categoriasIds: number[] } | null = null
    let novaMarca: string | null = null
    let novasCategorias: number[] = []
    /** A Nuvemshop JÁ recebeu a alteração (mesmo que a conferência depois reclame): o espelho e a auditoria refletem o que ela devolveu. */
    let gravou = false
    let mensagemErro: string | null = null

    try {
      if (categoriasInvalidas.length > 0) throw new Error('Alguma categoria escolhida não existe mais na loja. Atualize os dados.')
      const loja = await lojaDe(item.store_id)
      if ('erro' in loja) throw new Error(loja.erro)

      // 1) Estado ATUAL do produto direto na Nuvemshop (o espelho do banco pode estar atrasado).
      anterior = await buscarMarcaCategoriasProduto(loja.token, String(item.store_id), item.id_produto_ns)

      // 2) Calcula o novo estado e só envia o que muda.
      novaMarca = anterior.marca
      novasCategorias = anterior.categoriasIds
      const envio: { marca?: string | null; categoriasIds?: number[] } = {}

      if (marca) {
        const alvo = marca.acao === 'definir' ? marca.valor : null
        // Mesma marca com grafia diferente (maiúscula/espaço) conta como mudança: o objetivo é padronizar.
        if (alvo !== anterior.marca) {
          envio.marca = alvo
          novaMarca = alvo
        }
      }
      if (categorias) {
        const atual = anterior.categoriasIds
        const alvo =
          categorias.acao === 'limpar' ? []
          : categorias.acao === 'substituir' ? idsEscolhidos
          : categorias.acao === 'adicionar' ? [...new Set([...atual, ...idsEscolhidos])]
          : atual.filter((id) => !idsEscolhidos.includes(id))
        if (!mesmoConjunto(alvo, atual)) {
          envio.categoriasIds = alvo
          novasCategorias = alvo
        }
      }

      if (envio.marca !== undefined || envio.categoriasIds !== undefined) {
        // 3) Grava (só marca e/ou categorias) e confere o que a Nuvemshop devolveu.
        const gravado = await alterarMarcaCategoriasProduto(loja.token, String(item.store_id), item.id_produto_ns, envio)
        gravou = true
        novaMarca = gravado.marca
        novasCategorias = gravado.categoriasIds
        if (envio.marca !== undefined && normalizar(gravado.marca) !== normalizar(envio.marca)) {
          throw new Error(
            envio.marca === null
              ? 'A Nuvemshop não aceitou limpar a marca deste produto.'
              : `A marca não ficou como esperado (a Nuvemshop devolveu "${gravado.marca ?? 'vazia'}").`
          )
        }
        if (envio.categoriasIds !== undefined && !categoriasConferem(envio.categoriasIds, gravado.categoriasIds, paiDe)) {
          throw new Error('As categorias não ficaram como esperado depois da gravação. Confira o produto na Nuvemshop.')
        }
      }
    } catch (e) {
      mensagemErro = e instanceof Error ? e.message : 'Erro desconhecido ao alterar na Nuvemshop.'
    }

    const sucesso = mensagemErro === null
    if (gravou) {
      const { error: erroEspelho } = await admin.rpc('espelhar_marca_categoria_nuvemshop', {
        p_schema_name: TENANT_SCHEMA, p_store_id: item.store_id, p_id_produto: item.id_produto_ns,
        p_atualizar_marca: marca !== undefined, p_marca: novaMarca,
        p_atualizar_categorias: categorias !== undefined, p_categorias_ids: novasCategorias,
      })
      // A Nuvemshop já foi alterada: a falha aqui é só no espelho local; o próximo ETL do catálogo corrige.
      if (erroEspelho) console.error('[marca-categoria] Falha ao espelhar:', item.id_produto_ns, erroEspelho)
    }
    // Auditoria: toda tentativa fica registrada (sucesso, recusa da Nuvemshop ou recusa de validação). Produto que já estava assim não gera linha.
    if (!sucesso || gravou) {
      const { error: erroRegistro } = await admin.rpc('registrar_alteracao_marca_categoria', {
        p_schema_name: TENANT_SCHEMA, p_store_id: item.store_id, p_id_produto_ns: item.id_produto_ns,
        p_marca_anterior: anterior?.marca ?? null, p_marca_nova: novaMarca,
        p_categorias_anteriores: anterior?.categoriasIds ?? null, p_categorias_novas: gravou ? novasCategorias : null,
        p_sucesso: sucesso, p_erro: mensagemErro, p_usuario_id: user.id, p_usuario_email: user.email ?? null,
      })
      if (erroRegistro) console.error('[marca-categoria] Falha ao registrar alteração:', item.id_produto_ns, erroRegistro)
    }

    resultados.push({
      id_produto_ns: item.id_produto_ns, sucesso, alterado: gravou,
      marca: novaMarca, categorias_ids: novasCategorias, erro: mensagemErro,
    })
  }

  return NextResponse.json({ resultados })
}
