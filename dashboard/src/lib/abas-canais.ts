/** Abas fixas do Dashboard. "Geral" é o painel consolidado (com filtro de canais livre); as
 * demais fixam o filtro de canais no GRUPO do canal (canais_venda.grupo — cobre integrações
 * antigas/recriadas do mesmo marketplace, ex.: SHOPEE + D LEGEND). */
export type AbaDashboard = 'geral' | 'loja-fisica' | 'nuvemshop' | 'mercado-livre' | 'shopee' | 'tiktok'

export interface AbaCanal {
  id: AbaDashboard
  label: string
  /** canais_venda.grupo — null na aba Geral. */
  grupo: string | null
  /** Padrão de situações da aba (ids). Ausente = padrão geral do dashboard (situacoes_padrao_dashboard()). */
  situacoesPadrao?: number[]
}

/** Padrão de situações dos canais online (Nuvemshop, Mercado Livre, Shopee, TikTok Shop):
 * Atendido (9), P/ Separação (914897), Verificado (24) e Em aberto (6). P/ Separação herda de
 * Em aberto, mas entra por id; as demais herdeiras de Em aberto continuam de fora. */
const SITUACOES_PADRAO_CANAIS_ONLINE = [9, 914897, 24, 6]

export const ABAS_DASHBOARD: AbaCanal[] = [
  { id: 'geral', label: 'Geral', grupo: null },
  { id: 'loja-fisica', label: 'Loja Física', grupo: 'Loja Física (PDV)' },
  { id: 'nuvemshop', label: 'Nuvemshop', grupo: 'Nuvemshop', situacoesPadrao: SITUACOES_PADRAO_CANAIS_ONLINE },
  { id: 'mercado-livre', label: 'Mercado Livre', grupo: 'Mercado Livre', situacoesPadrao: SITUACOES_PADRAO_CANAIS_ONLINE },
  { id: 'shopee', label: 'Shopee', grupo: 'Shopee', situacoesPadrao: SITUACOES_PADRAO_CANAIS_ONLINE },
  { id: 'tiktok', label: 'TikTok Shop', grupo: 'TikTok', situacoesPadrao: SITUACOES_PADRAO_CANAIS_ONLINE },
]
