/** Abas fixas do Dashboard. "Geral" é o painel consolidado (com filtro de canais livre); as
 * demais fixam o filtro de canais no GRUPO do canal (canais_venda.grupo — cobre integrações
 * antigas/recriadas do mesmo marketplace, ex.: SHOPEE + D LEGEND). */
export type AbaDashboard = 'geral' | 'loja-fisica' | 'nuvemshop' | 'mercado-livre' | 'shopee' | 'tiktok'

export interface AbaCanal {
  id: AbaDashboard
  label: string
  /** canais_venda.grupo — null na aba Geral. */
  grupo: string | null
}

export const ABAS_DASHBOARD: AbaCanal[] = [
  { id: 'geral', label: 'Geral', grupo: null },
  { id: 'loja-fisica', label: 'Loja Física', grupo: 'Loja Física (PDV)' },
  { id: 'nuvemshop', label: 'Nuvemshop', grupo: 'Nuvemshop' },
  { id: 'mercado-livre', label: 'Mercado Livre', grupo: 'Mercado Livre' },
  { id: 'shopee', label: 'Shopee', grupo: 'Shopee' },
  { id: 'tiktok', label: 'TikTok Shop', grupo: 'TikTok' },
]
