import type { StatusRota, RotaVisita } from '@/hooks/use-rotas-visita'
import { CENTRO_PADRAO } from '@/lib/prospeccao'

export const LABEL_STATUS_ROTA: Record<StatusRota, string> = {
  planejada: 'Planejada',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
}

export const VARIANTE_STATUS_ROTA: Record<StatusRota, 'default' | 'secondary' | 'outline'> = {
  planejada: 'outline',
  em_andamento: 'secondary',
  concluida: 'default',
  cancelada: 'outline',
}

export const ORDEM_STATUS_ROTA: StatusRota[] = ['planejada', 'em_andamento', 'concluida', 'cancelada']

/** Origem do link do Google Maps: o endereço de partida gravado na rota (o Maps geocodifica
 * o texto) ou, se a rota não tiver, a Barbers World. */
export function origemRota(rota: Pick<RotaVisita, 'ponto_partida_endereco'>): { lat: number; lon: number } | string {
  return rota.ponto_partida_endereco || CENTRO_PADRAO
}

export function percentualVisitado(rota: Pick<RotaVisita, 'paradas_visitadas' | 'total_paradas'>): number {
  return rota.total_paradas > 0 ? Math.round((rota.paradas_visitadas / rota.total_paradas) * 100) : 0
}
