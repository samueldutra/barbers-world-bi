/** Logos dos canais de venda, por grupo (canais_venda.grupo — ver mapear_grupo() em
 * etl-bling-pedidos-vendas/sync-canais-venda-bling.py). Por grupo e não por id_loja pra
 * cobrir integrações antigas/recriadas do mesmo marketplace. Arquivos em public/canais/
 * (cópias locais dos ícones do Bling — os links do Bling/S3 podem expirar). */
const LOGO_POR_GRUPO: Record<string, string> = {
  'Mercado Livre': '/canais/mercadolivre.svg',
  TikTok: '/canais/tiktok.svg',
  Shopee: '/canais/shopee.svg',
  'Loja Física (PDV)': '/canais/loja-fisica.svg',
  'Venda Direta/Atacado': '/canais/atacado.svg',
  Nuvemshop: '/canais/nuvemshop.svg',
}

export function logoDoCanal(grupo: string | null | undefined): string | null {
  return grupo ? LOGO_POR_GRUPO[grupo] ?? null : null
}
