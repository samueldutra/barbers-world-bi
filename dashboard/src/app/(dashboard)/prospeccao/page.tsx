import { redirect } from 'next/navigation'

/** O módulo Prospecção foi dividido em Mapeamento de Leads e Rotas — o caminho antigo
 * continua funcionando (links/favoritos) e cai no mapeamento. */
export default function ProspeccaoPage() {
  redirect('/prospeccao/mapeamento')
}
