import type { Tenant } from '@/lib/tenant'

/** Abas do Dashboard. "Geral" é o painel consolidado (com filtro de canais livre); as demais fixam
 * o filtro de canais no GRUPO do canal (canais_venda.grupo — cobre integrações antigas/recriadas do
 * mesmo marketplace, ex.: SHOPEE + D LEGEND). Quais abas existem, e o padrão de situações de cada
 * uma, vêm da configuração do cliente (public.tenants.config.abas). */
export type AbaDashboard = string

export interface AbaCanal {
  id: AbaDashboard
  label: string
  /** canais_venda.grupo — null na aba Geral. */
  grupo: string | null
  /** Padrão de situações da aba (ids). Ausente = padrão geral do dashboard (situacoes_padrao_dashboard()). */
  situacoesPadrao?: number[]
}

export const ABA_GERAL: AbaCanal = { id: 'geral', label: 'Geral', grupo: null }

/** Abas do cliente: Geral + as configuradas para ele (cliente sem configuração = só a Geral). */
export function abasDoTenant(tenant: Pick<Tenant, 'config'> | null): AbaCanal[] {
  const configuradas = tenant?.config?.abas ?? []
  return [
    ABA_GERAL,
    ...configuradas.map((a) => ({
      id: a.id,
      label: a.label,
      grupo: a.grupo,
      situacoesPadrao: a.situacoes_padrao,
    })),
  ]
}
