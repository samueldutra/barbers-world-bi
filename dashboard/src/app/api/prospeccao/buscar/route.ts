import { NextRequest, NextResponse } from 'next/server'

/** Busca estabelecimentos por nicho perto de um ponto, via Google Places API (New).
 * Fica no server porque usa a chave de servidor (GOOGLE_PLACES_API_KEY), que nunca deve
 * chegar ao navegador — diferente da chave de mapa (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
 * essa é só pra exibição e pode ser pública (restrita por HTTP referrer no Google Cloud). */

export const dynamic = 'force-dynamic'

export interface ResultadoBusca {
  origemTipo: 'google'
  origemId: string
  nome: string
  endereco: string | null
  telefone: string | null
  latitude: number
  longitude: number
}

interface LugarGoogle {
  id: string
  displayName?: { text: string }
  formattedAddress?: string
  nationalPhoneNumber?: string
  location?: { latitude: number; longitude: number }
}

interface RespostaGoogle {
  places?: LugarGoogle[]
  error?: { message: string }
}

// Presets pros nichos mais comuns — mapeiam pro Table A do Google Places API (New)
// (https://developers.google.com/maps/documentation/places/web-service/place-types).
// Fora desses, cai no fallback de Text Search por texto livre.
const PRESETS_NICHO: Record<string, string[]> = {
  barbearia: ['barber_shop'],
  'salao de beleza': ['beauty_salon'],
  'barbearia e salao de beleza': ['barber_shop', 'beauty_salon'],
  academia: ['gym'],
  farmacia: ['pharmacy'],
  'pet shop': ['pet_store'],
  restaurante: ['restaurant'],
}

function normalizar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

function mapearResultado(lugar: LugarGoogle): ResultadoBusca | null {
  if (!lugar.location) return null
  return {
    origemTipo: 'google',
    origemId: lugar.id,
    nome: lugar.displayName?.text ?? 'Sem nome',
    endereco: lugar.formattedAddress ?? null,
    telefone: lugar.nationalPhoneNumber ?? null,
    latitude: lugar.location.latitude,
    longitude: lugar.location.longitude,
  }
}

const CAMPOS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.nationalPhoneNumber',
].join(',')

export async function POST(request: NextRequest) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY não configurada.')
    return NextResponse.json({ error: 'Busca de prospecção não configurada no servidor.' }, { status: 500 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  const { nicho, latitude, longitude, raioMetros } = (body ?? {}) as Record<string, unknown>

  if (typeof nicho !== 'string' || !nicho.trim()) {
    return NextResponse.json({ error: 'Informe o nicho de busca.' }, { status: 400 })
  }
  const lat = Number(latitude)
  const lon = Number(longitude)
  const raio = Math.min(Math.max(Number(raioMetros) || 5000, 200), 50000)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: 'Coordenadas inválidas.' }, { status: 400 })
  }

  const tiposPreset = PRESETS_NICHO[normalizar(nicho)]

  try {
    let resposta: Response
    if (tiposPreset) {
      resposta = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': CAMPOS,
        },
        body: JSON.stringify({
          includedTypes: tiposPreset,
          maxResultCount: 20,
          locationRestriction: {
            circle: { center: { latitude: lat, longitude: lon }, radius: raio },
          },
        }),
        signal: AbortSignal.timeout(15000),
      })
    } else {
      // Fallback: nicho fora dos presets conhecidos — busca por texto livre.
      resposta = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': CAMPOS,
        },
        body: JSON.stringify({
          textQuery: nicho,
          maxResultCount: 20,
          locationBias: {
            circle: { center: { latitude: lat, longitude: lon }, radius: raio },
          },
        }),
        signal: AbortSignal.timeout(15000),
      })
    }

    const dados: RespostaGoogle = await resposta.json()

    if (!resposta.ok) {
      console.error('Erro na busca de prospecção (Google Places):', dados.error)
      return NextResponse.json({ error: dados.error?.message ?? `Google Places respondeu ${resposta.status}.` }, { status: 502 })
    }

    const resultados = (dados.places ?? [])
      .map(mapearResultado)
      .filter((r): r is ResultadoBusca => r !== null)

    return NextResponse.json({ resultados })
  } catch (err) {
    console.error('Erro na busca de prospecção (Google Places):', err)
    return NextResponse.json({ error: 'Não foi possível buscar no momento. Tente novamente.' }, { status: 500 })
  }
}
