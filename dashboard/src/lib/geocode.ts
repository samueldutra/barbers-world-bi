export interface ResultadoGeocode {
  lat: number
  lon: number
  nomeExibicao: string
}

/** Geocodifica um endereço em texto livre via Nominatim (OpenStreetMap) — gratuito, sem
 * chave. Usado tanto pra recentralizar o mapa de busca quanto pro ponto de partida de uma
 * rota gerada por cidade. Retorna null se o endereço não for encontrado. */
export async function geocodificarEndereco(endereco: string): Promise<ResultadoGeocode | null> {
  const resposta = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(endereco)}`
  )
  const dados = await resposta.json()
  if (!Array.isArray(dados) || dados.length === 0) return null
  const { lat, lon, display_name } = dados[0]
  return { lat: Number(lat), lon: Number(lon), nomeExibicao: display_name }
}
