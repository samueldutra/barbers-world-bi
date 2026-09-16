/** Distância "em linha reta" entre 2 pontos (fórmula de Haversine) — suficiente pra ordenar
 * paradas por proximidade; não é a distância real de rota (precisaria do Directions API,
 * que é pago por chamada e não vale a pena só pra ordenação). */
export function distanciaMetros(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const lat1 = rad(a.lat)
  const lat2 = rad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Ordena os pontos pelo "vizinho mais próximo": começa do mais próximo do centro, depois
 * sempre pula pro ponto ainda não visitado mais próximo do atual. É uma heurística gulosa
 * pra o problema do caixeiro-viajante — não garante a rota globalmente mais curta, mas evita
 * zigue-zague óbvio e não depende de nenhuma API paga de otimização. */
export function ordenarPorProximidade<T extends { latitude: number; longitude: number }>(
  centro: { lat: number; lon: number },
  pontos: T[]
): T[] {
  const restantes = [...pontos]
  const ordenados: T[] = []
  let atual = centro

  while (restantes.length > 0) {
    let melhorIndex = 0
    let melhorDistancia = Infinity
    for (let i = 0; i < restantes.length; i++) {
      const d = distanciaMetros(atual, { lat: restantes[i].latitude, lon: restantes[i].longitude })
      if (d < melhorDistancia) {
        melhorDistancia = d
        melhorIndex = i
      }
    }
    const [proximo] = restantes.splice(melhorIndex, 1)
    ordenados.push(proximo)
    atual = { lat: proximo.latitude, lon: proximo.longitude }
  }

  return ordenados
}
