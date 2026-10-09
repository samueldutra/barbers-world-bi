/** Um preço encontrado na concorrência (Google Shopping). */
export interface ItemConcorrente {
  posicao: number
  loja: string | null
  titulo: string
  /** Preço em reais. */
  preco: number
  /** Como o Google mostrou (ex.: "R$ 1.299,90"). */
  precoTexto: string | null
  link: string | null
  thumbnail: string | null
}

export interface ProdutoComparacao {
  id: number
  codigo: string | null
  nome: string | null
  marca: string | null
  /** Nosso preço de cadastro no Bling. */
  preco: number | null
  imagemUrl: string | null
}

export interface ResultadoComparacao {
  produto: ProdutoComparacao
  /** Texto buscado no Google Shopping. */
  consulta: string
  /** Quando a busca foi feita (ISO). */
  consultadoEm: string
  /** true = veio do cache (busca feita nas últimas 24 h; não gastou busca paga). */
  doCache: boolean
  /** true = o teto diário de buscas foi atingido e estamos mostrando a última consulta, mesmo antiga. */
  limiteAtingido: boolean
  itens: ItemConcorrente[]
}
