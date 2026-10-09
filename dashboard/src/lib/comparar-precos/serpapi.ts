import type { ItemConcorrente } from '@/lib/comparar-precos/tipos'

/** Falhas da SerpApi com um tipo que a tela sabe explicar. */
export class ErroSerpApi extends Error {
  constructor(
    mensagem: string,
    public tipo: 'chave' | 'limite' | 'rede' | 'outro'
  ) {
    super(mensagem)
    this.name = 'ErroSerpApi'
  }
}

interface ResultadoShopping {
  position?: number
  title?: string
  link?: string
  product_link?: string
  source?: string
  price?: string
  extracted_price?: number
  thumbnail?: string
}

interface RespostaSerpApi {
  shopping_results?: ResultadoShopping[]
  error?: string
}

/** "R$ 1.299,90" -> 1299.9 (só quando a SerpApi não manda extracted_price). */
export function lerPrecoBrasileiro(texto: string | undefined): number | null {
  if (!texto) return null
  const limpo = texto.replace(/[^\d.,]/g, '')
  if (!limpo) return null
  const numero = Number(limpo.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(numero) ? numero : null
}

/** Busca no Google Shopping Brasil via SerpApi (1 busca paga por chamada). */
export async function buscarGoogleShopping(
  apiKey: string,
  consulta: string,
  fetchFn: typeof fetch = fetch
): Promise<ItemConcorrente[]> {
  const url = new URL('https://serpapi.com/search.json')
  url.search = new URLSearchParams({
    engine: 'google_shopping',
    q: consulta,
    gl: 'br',
    hl: 'pt',
    google_domain: 'google.com.br',
    api_key: apiKey,
  }).toString()

  let resposta: Response
  try {
    resposta = await fetchFn(url, { signal: AbortSignal.timeout(25_000) })
  } catch {
    throw new ErroSerpApi('Não foi possível falar com a SerpApi (rede ou tempo esgotado).', 'rede')
  }

  const corpo = (await resposta.json().catch(() => ({}))) as RespostaSerpApi

  if (resposta.status === 401 || resposta.status === 403) {
    throw new ErroSerpApi('A chave da SerpApi é inválida ou foi desativada.', 'chave')
  }
  if (resposta.status === 429 || /run out of searches|plan limit|rate limit/i.test(corpo.error ?? '')) {
    throw new ErroSerpApi('O limite de buscas da SerpApi acabou (plano ou taxa).', 'limite')
  }
  // "Sem resultados" não é erro: a busca foi feita, só não achou nada.
  if (/hasn't returned any results|no results/i.test(corpo.error ?? '')) return []
  if (!resposta.ok || corpo.error) {
    throw new ErroSerpApi(corpo.error ?? `A SerpApi respondeu ${resposta.status}.`, 'outro')
  }

  const itens: ItemConcorrente[] = []
  for (const r of corpo.shopping_results ?? []) {
    const preco = typeof r.extracted_price === 'number' ? r.extracted_price : lerPrecoBrasileiro(r.price)
    if (!r.title || preco == null || preco <= 0) continue
    itens.push({
      posicao: r.position ?? itens.length + 1,
      loja: r.source ?? null,
      titulo: r.title,
      preco,
      precoTexto: r.price ?? null,
      // Prefere o link da própria oferta; cai pra página do produto no Google Shopping.
      link: r.link ?? r.product_link ?? null,
      thumbnail: r.thumbnail ?? null,
    })
  }
  return itens
}
