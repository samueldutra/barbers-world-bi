import { MAX_PARADAS_ROTA } from '@/lib/prospeccao'

/** Monta um link do Google Maps com paradas nos pontos informados — não precisa de
 * nenhuma API paga, o próprio Google Maps calcula a rota ao abrir o link. Usado tanto pra
 * gerar uma rota ad-hoc (sem salvar) quanto pra reabrir uma rota já salva. A origem aceita
 * lat/lon (padrão, ponto de busca atual) ou um endereço em texto livre — o Google Maps
 * geocodifica o texto sozinho ao abrir o link, então uma rota salva com "ponto de partida"
 * em texto não precisa guardar lat/lon separado. */
export function montarUrlRota(
  origemInput: { lat: number; lon: number } | string | null,
  todosPontos: { latitude: number; longitude: number }[]
): string {
  // O Maps aceita ~25 pontos no link: acima disso o link falha. Quem tem mais paradas escolhe
  // o trecho (ver proximoTrecho) — aqui só garantimos que nunca estoura.
  const pontos = todosPontos.slice(0, MAX_PARADAS_ROTA)
  if (pontos.length === 0) return ''
  const destino = `${pontos[pontos.length - 1].latitude},${pontos[pontos.length - 1].longitude}`
  const paradas = pontos
    .slice(0, -1)
    .map((p) => `${p.latitude},${p.longitude}`)
    .join('|')
  const params = new URLSearchParams({ api: '1', destination: destino, travelmode: 'driving' })
  // Sem origem o Google Maps parte da localização atual de quem abriu o link.
  if (origemInput) params.set('origin', typeof origemInput === 'string' ? origemInput : `${origemInput.lat},${origemInput.lon}`)
  if (paradas) params.set('waypoints', paradas)
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/** Navegação até um único ponto (a partir da localização atual do celular) — o botão
 * "Navegar" de cada parada na tela da rota. */
export function montarUrlNavegacao(lat: number, lon: number): string {
  const params = new URLSearchParams({ api: '1', destination: `${lat},${lon}`, travelmode: 'driving' })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/** Trecho de uma rota longa que cabe num link do Maps: as próximas paradas AINDA NÃO visitadas
 * (até o limite do Maps), na ordem da rota. */
export function proximoTrecho<T extends { visita_realizada: boolean }>(paradas: T[]): T[] {
  return paradas.filter((p) => !p.visita_realizada).slice(0, MAX_PARADAS_ROTA)
}
