import { ErroSerpApi } from '@/lib/comparar-precos/serpapi'
import type { ItemConcorrente, ProdutoComparacao, ResultadoComparacao } from '@/lib/comparar-precos/tipos'

/** Quanto tempo uma busca vale: dentro desse prazo, abrir o produto de novo não gasta busca paga. */
export const CACHE_HORAS = 24
/** Teto de buscas pagas por dia (todos os usuários) — trava o gasto. Troque por env COMPARAR_PRECOS_LIMITE_DIA. */
export const LIMITE_PADRAO_POR_DIA = 100
const MAX_ITENS = 30
/** A nossa própria loja não entra na comparação. */
const LOJA_PROPRIA = /barbers?\s*world|barbersworld/i

export class ErroComparacao extends Error {
  constructor(
    mensagem: string,
    public status: number,
    public codigo: 'PRODUTO_NAO_ENCONTRADO' | 'NAO_CONFIGURADO' | 'LIMITE_DIARIO' | 'FALHA_BUSCA'
  ) {
    super(mensagem)
    this.name = 'ErroComparacao'
  }
}

/** EAN/GTIN: só dígitos, 8, 12, 13 ou 14. Alguns produtos têm o EAN no campo "código". */
export function pareceEan(codigo: string | null | undefined): boolean {
  return !!codigo && /^\d{8}$|^\d{12,14}$/.test(codigo.trim())
}

/** Texto da busca: o nome do produto (+ marca, se o nome não a traz). */
export function montarConsulta(produto: Pick<ProdutoComparacao, 'nome' | 'marca'>): string {
  const nome = (produto.nome ?? '').replace(/\s+/g, ' ').trim()
  const marca = (produto.marca ?? '').trim()
  const trazMarca = marca !== '' && nome.toLowerCase().includes(marca.toLowerCase())
  return (marca && !trazMarca ? `${nome} ${marca}` : nome).slice(0, 120)
}

/** Tira a nossa loja, repetidos e itens sem preço; ordena pelo menor preço. */
export function filtrarItens(itens: ItemConcorrente[]): ItemConcorrente[] {
  const vistos = new Set<string>()
  const resultado: ItemConcorrente[] = []
  for (const item of itens) {
    if (item.preco <= 0) continue
    if (LOJA_PROPRIA.test(item.loja ?? '') || LOJA_PROPRIA.test(item.link ?? '')) continue
    const chave = `${(item.loja ?? '').toLowerCase()}|${item.preco}|${item.titulo.toLowerCase()}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    resultado.push(item)
  }
  return resultado.sort((a, b) => a.preco - b.preco || a.posicao - b.posicao).slice(0, MAX_ITENS)
}

interface ProdutoLinha {
  id_produto: number
  codigo: string | null
  nome: string | null
  marca: string | null
  preco: number | string | null
  imagem_url: string | null
}
interface ConsultaLinha {
  id: string
  consulta: string
  consultado_em: string
  total_resultados: number
}
interface ItemLinha {
  posicao: number
  loja: string | null
  titulo: string
  preco: number | string
  preco_texto: string | null
  link: string | null
  thumbnail: string | null
}

/** Dependências externas — injetáveis pra testar sem gastar buscas. */
export interface DependenciasComparacao {
  rpc: <T>(nome: string, args: Record<string, unknown>) => Promise<T>
  /** Busca paga. Só é chamada quando não há cache válido. */
  buscar: (consulta: string) => Promise<ItemConcorrente[]>
  chaveConfigurada: boolean
  agora: () => number
}

interface Opcoes {
  idProduto: number
  /** Texto da busca escolhido pelo usuário (senão, montado a partir do produto). */
  consulta?: string
  /** Ignora o cache e faz uma busca nova. */
  forcar?: boolean
  usuarioId: string
  limiteDia?: number
}

function paraItens(linhas: ItemLinha[]): ItemConcorrente[] {
  return linhas.map((l) => ({
    posicao: l.posicao,
    loja: l.loja,
    titulo: l.titulo,
    preco: Number(l.preco),
    precoTexto: l.preco_texto,
    link: l.link,
    thumbnail: l.thumbnail,
  }))
}

export async function compararPrecos(deps: DependenciasComparacao, opcoes: Opcoes): Promise<ResultadoComparacao> {
  const linhaProduto = (await deps.rpc<ProdutoLinha[]>('obter_produto_comparacao', { p_id_produto: opcoes.idProduto }))?.[0]
  if (!linhaProduto) throw new ErroComparacao('Produto não encontrado.', 404, 'PRODUTO_NAO_ENCONTRADO')

  const produto: ProdutoComparacao = {
    id: Number(linhaProduto.id_produto),
    codigo: linhaProduto.codigo,
    nome: linhaProduto.nome,
    marca: linhaProduto.marca,
    preco: linhaProduto.preco == null ? null : Number(linhaProduto.preco),
    imagemUrl: linhaProduto.imagem_url,
  }

  const consultaPedida = opcoes.consulta?.replace(/\s+/g, ' ').trim().slice(0, 120) || undefined
  const consulta = consultaPedida ?? montarConsulta(produto)
  if (!consulta) throw new ErroComparacao('O produto não tem nome para buscar.', 422, 'PRODUTO_NAO_ENCONTRADO')

  const ultima = (await deps.rpc<ConsultaLinha[]>('obter_ultima_consulta_precos', { p_id_produto: produto.id }))?.[0]
  const idadeHoras = ultima ? (deps.agora() - new Date(ultima.consultado_em).getTime()) / 3_600_000 : Infinity

  const devolverDaConsulta = async (c: ConsultaLinha, extra: { doCache: boolean; limiteAtingido: boolean }) => {
    const itens = await deps.rpc<ItemLinha[]>('obter_itens_consulta_precos', { p_consulta_id: c.id })
    return {
      produto,
      consulta: c.consulta,
      consultadoEm: new Date(c.consultado_em).toISOString(),
      itens: paraItens(itens ?? []),
      ...extra,
    } satisfies ResultadoComparacao
  }

  // Cache: busca recente do produto. Sem texto escolhido, serve qualquer uma recente (mesmo que o
  // usuário tenha refinado o texto antes); com texto escolhido, só se for o mesmo.
  const cacheValido = !!ultima && !opcoes.forcar && idadeHoras < CACHE_HORAS && (!consultaPedida || ultima.consulta === consultaPedida)
  if (ultima && cacheValido) return devolverDaConsulta(ultima, { doCache: true, limiteAtingido: false })

  // Daqui pra frente a busca é PAGA.
  if (!deps.chaveConfigurada) {
    if (ultima) return devolverDaConsulta(ultima, { doCache: true, limiteAtingido: false })
    throw new ErroComparacao('A comparação de preços não está configurada no servidor (SERPAPI_API_KEY).', 503, 'NAO_CONFIGURADO')
  }

  const limite = opcoes.limiteDia ?? LIMITE_PADRAO_POR_DIA
  const hoje = Number(await deps.rpc<number>('contar_consultas_precos_hoje', {}))
  if (hoje >= limite) {
    if (ultima) return devolverDaConsulta(ultima, { doCache: true, limiteAtingido: true })
    throw new ErroComparacao(`O limite de ${limite} buscas por dia foi atingido. Tente amanhã.`, 429, 'LIMITE_DIARIO')
  }

  let encontrados: ItemConcorrente[]
  try {
    encontrados = await deps.buscar(consulta)
  } catch (err) {
    const mensagem = err instanceof ErroSerpApi ? err.message : 'Não foi possível buscar os preços agora.'
    throw new ErroComparacao(mensagem, err instanceof ErroSerpApi && err.tipo === 'limite' ? 429 : 502, 'FALHA_BUSCA')
  }

  const itens = filtrarItens(encontrados)
  const salvo = (
    await deps.rpc<{ id: string; consultado_em: string }[]>('salvar_consulta_precos', {
      p_id_produto: produto.id,
      p_consulta: consulta,
      p_itens: itens,
      p_criado_por: opcoes.usuarioId,
    })
  )?.[0]

  return {
    produto,
    consulta,
    consultadoEm: new Date(salvo?.consultado_em ?? deps.agora()).toISOString(),
    doCache: false,
    limiteAtingido: false,
    itens,
  }
}
