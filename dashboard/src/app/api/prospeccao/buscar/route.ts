import { NextRequest, NextResponse } from 'next/server'

/** Busca estabelecimentos por nicho perto de um ponto, via Overpass API (OpenStreetMap).
 * Fica no server porque a Overpass não manda Access-Control-Allow-Origin — chamar direto
 * do navegador é bloqueado por CORS. (Nominatim, usado só pra geocodificar, já manda
 * `*` e pode ser chamado direto do client.) */

export const dynamic = 'force-dynamic'

interface ElementoOverpass {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string | undefined>
}

interface RespostaOverpass {
  elements: ElementoOverpass[]
}

export interface ResultadoBusca {
  osmType: 'node' | 'way' | 'relation'
  osmId: number
  nome: string
  endereco: string | null
  telefone: string | null
  latitude: number
  longitude: number
}

// Presets pros nichos mais comuns — mapeiam pra tags reais do OpenStreetMap, que dão
// resultado muito mais confiável que buscar por nome. Fora desses, cai no fallback de
// busca por nome (ver montarFiltroOverpass).
const PRESETS_NICHO: Record<string, string> = {
  barbearia: '["shop"="hairdresser"]',
  'salao de beleza': '["shop"="beauty"]',
  'barbearia e salao de beleza': '["shop"~"^(hairdresser|beauty)$"]',
  academia: '["leisure"="fitness_centre"]',
  farmacia: '["amenity"="pharmacy"]',
  'pet shop': '["shop"="pet"]',
  restaurante: '["amenity"="restaurant"]',
}

function normalizar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function escaparRegexOverpass(texto: string): string {
  return texto.replace(/["\\]/g, '\\$&')
}

function montarFiltroOverpass(nicho: string): string {
  const preset = PRESETS_NICHO[normalizar(nicho)]
  if (preset) return preset
  // Fallback: qualquer elemento nomeado cujo nome contenha o termo buscado.
  return `["name"~"${escaparRegexOverpass(nicho)}",i]`
}

function formatarEndereco(tags: Record<string, string | undefined>): string | null {
  const partes = [tags['addr:street'], tags['addr:housenumber'], tags['addr:suburb'], tags['addr:city']].filter(
    Boolean
  )
  return partes.length > 0 ? partes.join(', ') : null
}

export async function POST(request: NextRequest) {
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
  const raio = Math.min(Math.max(Number(raioMetros) || 5000, 200), 20000)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: 'Coordenadas inválidas.' }, { status: 400 })
  }

  const filtro = montarFiltroOverpass(nicho)
  const around = `(around:${raio},${lat},${lon})`
  const query = `[out:json][timeout:25];(node${filtro}${around};way${filtro}${around};);out center 80;`

  try {
    const resposta = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'BarbersWorldBI/1.0 (prospeccao interna; contato: samueldutra.rp@gmail.com)',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(28000),
    })

    if (!resposta.ok) {
      return NextResponse.json({ error: `Overpass API respondeu ${resposta.status}.` }, { status: 502 })
    }

    const dados: RespostaOverpass = await resposta.json()

    const resultados: ResultadoBusca[] = dados.elements
      .map((el) => {
        const tags = el.tags ?? {}
        const posicao = el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center
        if (posicao?.lat === undefined || posicao?.lon === undefined) return null
        return {
          osmType: el.type,
          osmId: el.id,
          nome: tags.name ?? 'Sem nome',
          endereco: formatarEndereco(tags),
          telefone: tags.phone ?? tags['contact:phone'] ?? null,
          latitude: posicao.lat,
          longitude: posicao.lon,
        }
      })
      .filter((r): r is ResultadoBusca => r !== null)

    return NextResponse.json({ resultados })
  } catch (err) {
    console.error('Erro na busca de prospecção (Overpass):', err)
    return NextResponse.json({ error: 'Não foi possível buscar no momento. Tente novamente.' }, { status: 500 })
  }
}
