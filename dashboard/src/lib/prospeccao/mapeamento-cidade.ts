import { getAdminClient } from '@/lib/supabase/admin'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { buscarPorTipoNoCirculo, MAX_RESULTADOS_PLACES, type ResultadoBusca } from '@/lib/places'
import { ordenarPorProximidade } from '@/lib/distancia'

/** Mapeamento automático de TODAS as barbearias de uma cidade, em segundo plano.
 *
 * O Google Places devolve no máximo 20 lugares por busca. Pra cobrir a cidade toda dividimos a
 * área do município em retângulos e buscamos com o círculo que circunscreve cada um (quadtree):
 * se a busca volta com menos de 20 resultados, aquela área está completa; se volta cheia (20 —
 * pode haver mais), o retângulo é dividido em 4 quadrantes (partição exata, sem sobreposição) e
 * cada um é buscado. Áreas vazias custam 1 busca e o centro denso é detalhado.
 *
 * Importante: subdividir por quadrantes e não por círculos menores dentro do círculo pai —
 * círculos filhos se sobrepõem e essa redundância se multiplica a cada nível. */

const TIPOS_BARBEARIA = ['barber_shop']

/** Maior retângulo inicial: o círculo que o circunscreve tem que caber nos 50 km que o Google aceita. */
const MEIO_LADO_INICIAL_MAX_M = 35_000 // hipotenusa 49,5 km
/** Não subdivide abaixo disso (o retângulo já é menor que um quarteirão). */
const MEIO_LADO_MIN_M = 150
const LOTE_PARALELO = 6
/** Teto de buscas por cidade — trava o custo em cidades enormes (o mapeamento termina "parcial"). */
export const MAX_CIRCULOS_POR_CIDADE = 500
const MAX_TENTATIVAS_POR_CIRCULO = 3
const FALHAS_SEGUIDAS_PARA_ABORTAR = 2

/** Área a buscar: retângulo de centro (lat, lon) e meios-lados hx/hy em metros. A busca usa o
 * círculo que o circunscreve (raio = hipotenusa). */
export interface Circulo {
  lat: number
  lon: number
  /** Meio-lado leste-oeste, em metros. */
  hx: number
  /** Meio-lado norte-sul, em metros. */
  hy: number
  /** Tentativas já feitas (falhas de rede/Google). */
  t?: number
}

/** Raio (m) do círculo que circunscreve a área. */
export function raioDe(c: Pick<Circulo, 'hx' | 'hy'>): number {
  return Math.ceil(Math.hypot(c.hx, c.hy))
}

export interface CaixaGeografica {
  sul: number
  norte: number
  oeste: number
  leste: number
}

const METROS_POR_GRAU_LAT = 111_320
const graus = (metros: number, lat: number, eixo: 'lat' | 'lon') =>
  eixo === 'lat' ? metros / METROS_POR_GRAU_LAT : metros / (METROS_POR_GRAU_LAT * Math.cos((lat * Math.PI) / 180))

/** Áreas iniciais que cobrem a caixa do município (1 só se couber num círculo de busca). */
export function gerarCirculosIniciais(caixa: CaixaGeografica): Circulo[] {
  const latMeio = (caixa.sul + caixa.norte) / 2
  const alturaM = (caixa.norte - caixa.sul) * METROS_POR_GRAU_LAT
  const larguraM = (caixa.leste - caixa.oeste) * METROS_POR_GRAU_LAT * Math.cos((latMeio * Math.PI) / 180)

  const colunas = Math.max(1, Math.ceil(larguraM / (2 * MEIO_LADO_INICIAL_MAX_M)))
  const linhas = Math.max(1, Math.ceil(alturaM / (2 * MEIO_LADO_INICIAL_MAX_M)))
  const hx = Math.max(larguraM / colunas / 2, MEIO_LADO_MIN_M)
  const hy = Math.max(alturaM / linhas / 2, MEIO_LADO_MIN_M)

  const areas: Circulo[] = []
  for (let i = 0; i < linhas; i++) {
    for (let j = 0; j < colunas; j++) {
      areas.push({
        lat: caixa.sul + graus((2 * i + 1) * hy, latMeio, 'lat'),
        lon: caixa.oeste + graus((2 * j + 1) * hx, latMeio, 'lon'),
        hx,
        hy,
      })
    }
  }
  return areas
}

/** Os 4 quadrantes da área (partição exata, sem sobreposição). */
export function subdividir(c: Circulo): Circulo[] {
  const hx = c.hx / 2
  const hy = c.hy / 2
  return [
    [hx, hy],
    [hx, -hy],
    [-hx, hy],
    [-hx, -hy],
  ].map(([dx, dy]) => ({
    lat: c.lat + graus(dy, c.lat, 'lat'),
    lon: c.lon + graus(dx, c.lat, 'lon'),
    hx,
    hy,
  }))
}

export function podeSubdividir(c: Circulo): boolean {
  return Math.max(c.hx, c.hy) / 2 >= MEIO_LADO_MIN_M
}

/** Caixa do município: Nominatim (limites administrativos do OpenStreetMap). */
async function caixaDoMunicipio(nome: string, estado: string): Promise<CaixaGeografica> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.search = new URLSearchParams({ city: nome, state: estado, country: 'Brazil', format: 'json', limit: '1' }).toString()
  const resposta = await fetch(url, {
    headers: { 'User-Agent': 'BarbersWorldBI/1.0 (mapeamento de cidades)' },
    signal: AbortSignal.timeout(15000),
  })
  if (!resposta.ok) throw new Error(`Nominatim respondeu ${resposta.status}.`)
  const dados = (await resposta.json()) as { boundingbox?: string[] }[]
  const box = dados[0]?.boundingbox
  if (!box || box.length !== 4) throw new Error(`Não foi possível localizar ${nome}, ${estado} no mapa.`)
  const [sul, norte, oeste, leste] = box.map(Number)
  if (![sul, norte, oeste, leste].every(Number.isFinite)) throw new Error(`Limites inválidos para ${nome}, ${estado}.`)
  return { sul, norte, oeste, leste }
}

export interface Mapeamento {
  id: number
  id_ibge: number
  cidade: string
  uf: string
  estado: string
  status: string
  token: string
  fila: Circulo[]
  circulos_total: number
  circulos_processados: number
  parcial: boolean
  ponto_lat: number | null
  ponto_lon: number | null
}

/** Dependências externas do processamento (banco, Google, geocodificação) — injetáveis pra testar
 * o algoritmo de cobertura com dados simulados, sem gastar buscas no Google. */
export interface Dependencias {
  rpc: <T>(nome: string, args: Record<string, unknown>) => Promise<T>
  buscar: typeof buscarPorTipoNoCirculo
  caixa: (nome: string, estado: string) => Promise<CaixaGeografica>
}

async function rpcReal<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminClient().rpc(nome, { p_schema_name: TENANT_SCHEMA, ...args })
  if (error) throw new Error(`${nome}: ${error.message}`)
  return data as T
}

const depsReais: Dependencias = { rpc: rpcReal, buscar: buscarPorTipoNoCirculo, caixa: caixaDoMunicipio }

export async function obterMapeamento(jobId: number, deps: Dependencias = depsReais): Promise<Mapeamento | null> {
  const linhas = await deps.rpc<Mapeamento[]>('obter_mapeamento_cidade', { p_job_id: jobId })
  return linhas?.[0] ?? null
}

export async function validarToken(jobId: number, token: string): Promise<boolean> {
  const job = await obterMapeamento(jobId)
  return !!job && job.token === token
}

async function falhar(deps: Dependencias, jobId: number, erro: string) {
  console.error(`Mapeamento ${jobId} falhou:`, erro)
  await deps.rpc('falhar_mapeamento_cidade', { p_job_id: jobId, p_erro: erro })
}

/** Depois da última busca: ordena as barbearias da cidade pela proximidade do ponto de partida,
 * grava como paradas da rota e marca a cidade como mapeada. */
async function finalizar(deps: Dependencias, job: Mapeamento, parcial: boolean) {
  const leads = await deps.rpc<{ id: number; latitude: number; longitude: number }[]>('obter_leads_da_cidade', {
    p_id_ibge: job.id_ibge,
  })
  const origem =
    job.ponto_lat != null && job.ponto_lon != null
      ? { lat: job.ponto_lat, lon: job.ponto_lon }
      : leads[0]
        ? { lat: leads[0].latitude, lon: leads[0].longitude }
        : { lat: 0, lon: 0 }
  const ordenados = ordenarPorProximidade(origem, leads ?? [])
  await deps.rpc('concluir_mapeamento_cidade', {
    p_job_id: job.id,
    p_lead_ids: ordenados.map((l) => l.id),
    p_parcial: parcial,
  })
}

/** Processa o mapeamento por até `orcamentoMs`. Devolve 'continua' se ainda há círculos na fila
 * (quem chamou deve disparar a continuação), 'concluido' ou 'erro'. Idempotente: se a cadeia cair,
 * qualquer chamada retoma do ponto salvo na fila. */
export async function processarMapeamento(
  jobId: number,
  orcamentoMs: number,
  deps: Dependencias = depsReais
): Promise<'concluido' | 'continua' | 'erro'> {
  const inicio = Date.now()
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    await falhar(deps, jobId, 'GOOGLE_PLACES_API_KEY não configurada no servidor.')
    return 'erro'
  }

  try {
    const job = await obterMapeamento(jobId, deps)
    if (!job || job.status === 'concluido' || job.status === 'erro') return job?.status === 'erro' ? 'erro' : 'concluido'

    let fila = job.fila ?? []
    let total = job.circulos_total
    let processados = job.circulos_processados
    let parcial = job.parcial

    // Primeira execução: descobre a área do município e monta os círculos iniciais.
    if (total === 0 && fila.length === 0) {
      const caixa = await deps.caixa(job.cidade, job.estado)
      fila = gerarCirculosIniciais(caixa)
      total = fila.length
      await deps.rpc('salvar_progresso_mapeamento', {
        p_job_id: job.id,
        p_fila: fila,
        p_circulos_total: total,
        p_circulos_processados: 0,
        p_leads_novos_somar: 0,
        p_status: 'mapeando',
        p_parcial: false,
      })
    }

    let falhasSeguidas = 0
    while (fila.length > 0) {
      const lote = fila.splice(0, LOTE_PARALELO)
      const resultados = await Promise.allSettled(
        lote.map((c) => deps.buscar(apiKey, TIPOS_BARBEARIA, { latitude: c.lat, longitude: c.lon }, raioDe(c)))
      )

      const novosCirculos: Circulo[] = []
      const leads = new Map<string, ResultadoBusca>()
      let falhasNoLote = 0
      let ultimoErro = ''

      resultados.forEach((res, i) => {
        const circulo = lote[i]
        if (res.status === 'fulfilled') {
          processados++
          for (const lugar of res.value) leads.set(lugar.origemId, lugar)
          if (res.value.length >= MAX_RESULTADOS_PLACES) {
            if (podeSubdividir(circulo)) {
              novosCirculos.push(...subdividir(circulo))
            } else {
              parcial = true // saturado até no menor círculo: pode haver barbearias a mais
            }
          }
        } else {
          falhasNoLote++
          ultimoErro = res.reason instanceof Error ? res.reason.message : String(res.reason)
          const tentativas = (circulo.t ?? 0) + 1
          if (tentativas < MAX_TENTATIVAS_POR_CIRCULO) {
            novosCirculos.push({ ...circulo, t: tentativas }) // tenta de novo mais tarde
          } else {
            processados++
            parcial = true // desistiu desse círculo
          }
        }
      })

      falhasSeguidas = falhasNoLote === lote.length ? falhasSeguidas + 1 : 0
      if (falhasSeguidas >= FALHAS_SEGUIDAS_PARA_ABORTAR) {
        await falhar(deps, jobId, `Falha ao consultar o Google Places: ${ultimoErro}`)
        return 'erro'
      }

      let novos = 0
      if (leads.size > 0) {
        novos = await deps.rpc<number>('salvar_leads_novos', {
          p_leads: Array.from(leads.values()).map((l) => ({ ...l, nicho: 'barbearia' })),
        })
      }

      fila = fila.concat(novosCirculos)
      total += novosCirculos.filter((c) => !c.t).length // retentativas não aumentam o total
      if (processados >= MAX_CIRCULOS_POR_CIDADE && fila.length > 0) {
        fila = []
        parcial = true // atingiu o teto de buscas: termina com o que já tem
      }

      await deps.rpc('salvar_progresso_mapeamento', {
        p_job_id: job.id,
        p_fila: fila,
        p_circulos_total: total,
        p_circulos_processados: processados,
        p_leads_novos_somar: novos,
        p_status: 'mapeando',
        p_parcial: parcial,
      })

      if (fila.length > 0 && Date.now() - inicio > orcamentoMs) return 'continua'
    }

    await finalizar(deps, job, parcial)
    return 'concluido'
  } catch (err) {
    await falhar(deps, jobId, err instanceof Error ? err.message : String(err)).catch(() => {})
    return 'erro'
  }
}
