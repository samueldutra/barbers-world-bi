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

// O Google Places (New) devolve no máximo 20 resultados por chamada, não importa o raio —
// por isso um raio de 20km com muito mais de 20 estabelecimentos sempre traz o mesmo
// subconjunto (os mais relevantes perto do centro). A forma de cobrir mais área é somar
// buscas a partir de vários pontos, não aumentar o raio de um único ponto. Limitamos a
// quantidade de pontos por requisição pra não estourar custo/latência.
const MAX_PONTOS = 8

interface PontoBusca {
  latitude: number
  longitude: number
}

async function buscarUmPonto(
  apiKey: string,
  nicho: string,
  tiposPreset: string[] | undefined,
  ponto: PontoBusca,
  raio: number
): Promise<ResultadoBusca[]> {
  const resposta = tiposPreset
    ? await fetch('https://places.googleapis.com/v1/places:searchNearby', {
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
            circle: { center: ponto, radius: raio },
          },
        }),
        signal: AbortSignal.timeout(15000),
      })
    : // Fallback: nicho fora dos presets conhecidos — busca por texto livre.
      await fetch('https://places.googleapis.com/v1/places:searchText', {
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
            circle: { center: ponto, radius: raio },
          },
        }),
        signal: AbortSignal.timeout(15000),
      })

  const dados: RespostaGoogle = await resposta.json()
  if (!resposta.ok) {
    console.error('Erro na busca de prospecção (Google Places):', dados.error)
    throw new Error(dados.error?.message ?? `Google Places respondeu ${resposta.status}.`)
  }

  return (dados.places ?? []).map(mapearResultado).filter((r): r is ResultadoBusca => r !== null)
}

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

  const { nicho, pontos, raioMetros } = (body ?? {}) as Record<string, unknown>

  if (typeof nicho !== 'string' || !nicho.trim()) {
    return NextResponse.json({ error: 'Informe o nicho de busca.' }, { status: 400 })
  }
  if (!Array.isArray(pontos) || pontos.length === 0) {
    return NextResponse.json({ error: 'Informe ao menos um ponto de busca.' }, { status: 400 })
  }

  const pontosValidados: PontoBusca[] = []
  for (const p of pontos.slice(0, MAX_PONTOS)) {
    const lat = Number((p as Record<string, unknown>)?.latitude)
    const lon = Number((p as Record<string, unknown>)?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: 'Coordenadas inválidas em um dos pontos.' }, { status: 400 })
    }
    pontosValidados.push({ latitude: lat, longitude: lon })
  }

  const raio = Math.min(Math.max(Number(raioMetros) || 5000, 200), 50000)
  const tiposPreset = PRESETS_NICHO[normalizar(nicho)]

  try {
    const listas = await Promise.all(
      pontosValidados.map((ponto) => buscarUmPonto(apiKey, nicho, tiposPreset, ponto, raio))
    )

    const vistos = new Set<string>()
    const resultados: ResultadoBusca[] = []
    for (const lista of listas) {
      for (const item of lista) {
        const chave = `${item.origemTipo}:${item.origemId}`
        if (vistos.has(chave)) continue
        vistos.add(chave)
        resultados.push(item)
      }
    }

    return NextResponse.json({ resultados })
  } catch (err) {
    console.error('Erro na busca de prospecção (Google Places):', err)
    const mensagem = err instanceof Error ? err.message : 'Não foi possível buscar no momento. Tente novamente.'
    return NextResponse.json({ error: mensagem }, { status: 502 })
  }
}
