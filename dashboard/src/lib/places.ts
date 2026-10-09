/** Google Places API (New) — tipos e helpers compartilhados entre a busca manual
 * (/api/prospeccao/buscar) e o mapeamento automático de cidades. Só roda no servidor: usa a
 * chave GOOGLE_PLACES_API_KEY. */

export interface ResultadoBusca {
  origemTipo: 'google'
  origemId: string
  nome: string
  endereco: string | null
  cidade: string | null
  uf: string | null
  telefone: string | null
  latitude: number
  longitude: number
}

interface ComponenteEndereco {
  longText?: string
  shortText?: string
  // O Google nem sempre devolve "types" em todos os componentes de endereço.
  types?: string[]
}

export interface LugarGoogle {
  id: string
  displayName?: { text: string }
  formattedAddress?: string
  addressComponents?: ComponenteEndereco[]
  nationalPhoneNumber?: string
  location?: { latitude: number; longitude: number }
}

/** Cidade vem estruturada (addressComponents), não extraída do endereço em texto livre —
 * mais confiável. "locality" é o tipo padrão do Google pra cidade; em áreas raramente
 * cobertas por município formal (raro no Brasil urbano), cai pro nível administrativo 2. */
export function extrairCidade(componentes: ComponenteEndereco[] | undefined): string | null {
  if (!componentes) return null
  const cidade =
    componentes.find((c) => c.types?.includes('locality')) ??
    componentes.find((c) => c.types?.includes('administrative_area_level_2'))
  return cidade?.longText ?? null
}

/** UF (sigla) — administrative_area_level_1. */
export function extrairUf(componentes: ComponenteEndereco[] | undefined): string | null {
  const uf = componentes?.find((c) => c.types?.includes('administrative_area_level_1'))?.shortText
  return uf && uf.length === 2 ? uf.toUpperCase() : null
}

export function mapearResultado(lugar: LugarGoogle): ResultadoBusca | null {
  if (!lugar.location) return null
  return {
    origemTipo: 'google',
    origemId: lugar.id,
    nome: lugar.displayName?.text ?? 'Sem nome',
    endereco: lugar.formattedAddress ?? null,
    cidade: extrairCidade(lugar.addressComponents),
    uf: extrairUf(lugar.addressComponents),
    telefone: lugar.nationalPhoneNumber ?? null,
    latitude: lugar.location.latitude,
    longitude: lugar.location.longitude,
  }
}

export const CAMPOS_PLACES = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'places.nationalPhoneNumber',
].join(',')

/** O Google devolve no máximo 20 lugares por busca. */
export const MAX_RESULTADOS_PLACES = 20

export interface RespostaPlaces {
  places?: LugarGoogle[]
  error?: { message: string }
}

/** Busca por tipo dentro de um círculo (Nearby Search). Lança erro com a mensagem do Google. */
export async function buscarPorTipoNoCirculo(
  apiKey: string,
  tipos: string[],
  centro: { latitude: number; longitude: number },
  raioMetros: number
): Promise<ResultadoBusca[]> {
  const resposta = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': CAMPOS_PLACES,
    },
    body: JSON.stringify({
      includedTypes: tipos,
      maxResultCount: MAX_RESULTADOS_PLACES,
      locationRestriction: { circle: { center: centro, radius: raioMetros } },
    }),
    signal: AbortSignal.timeout(15000),
  })
  const dados: RespostaPlaces = await resposta.json()
  if (!resposta.ok) {
    throw new Error(dados.error?.message ?? `Google Places respondeu ${resposta.status}.`)
  }
  return (dados.places ?? []).map(mapearResultado).filter((r): r is ResultadoBusca => r !== null)
}
