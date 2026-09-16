/** Monta um link do Google Maps com paradas nos pontos informados — não precisa de
 * nenhuma API paga, o próprio Google Maps calcula a rota ao abrir o link. Usado tanto pra
 * gerar uma rota ad-hoc (sem salvar) quanto pra reabrir uma rota já salva. */
export function montarUrlRota(centro: { lat: number; lon: number }, pontos: { latitude: number; longitude: number }[]): string {
  if (pontos.length === 0) return ''
  const origem = `${centro.lat},${centro.lon}`
  const destino = `${pontos[pontos.length - 1].latitude},${pontos[pontos.length - 1].longitude}`
  const paradas = pontos
    .slice(0, -1)
    .map((p) => `${p.latitude},${p.longitude}`)
    .join('|')
  const params = new URLSearchParams({ api: '1', origin: origem, destination: destino, travelmode: 'driving' })
  if (paradas) params.set('waypoints', paradas)
  return `https://www.google.com/maps/dir/?${params.toString()}`
}
