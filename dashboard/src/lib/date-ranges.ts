/**
 * Períodos rápidos e comparação automática (requisitos seção 1, 3, 4.1, 4.3).
 *
 * Regra de comparação padrão: "período anterior equivalente" — mesmo número de dias do
 * mês anterior, começando no dia 1. Ex.: 01/09 a 12/09 compara com 01/08 a 12/08 (nunca
 * o mês anterior inteiro, pra não comparar mês incompleto com mês completo).
 */

export type PeriodoPreset =
  | 'hoje'
  | 'ontem'
  | 'ultimos_7_dias'
  | 'ultimos_30_dias'
  | 'mes_atual'
  | 'mes_anterior'
  | 'este_ano'
  | 'personalizado'

export type ModoComparacao =
  | 'periodo_anterior'
  | 'mes_anterior_equivalente'
  | 'ano_anterior_equivalente'
  | 'sem_comparacao'

export interface RangeData {
  inicio: Date
  fim: Date
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function inicioDoDia(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

export function adicionarDias(d: Date, dias: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + dias)
  return r
}

export function obterRangePreset(preset: PeriodoPreset, hoje: Date = new Date()): RangeData {
  const h = inicioDoDia(hoje)

  switch (preset) {
    case 'hoje':
      return { inicio: h, fim: h }
    case 'ontem': {
      const ontem = adicionarDias(h, -1)
      return { inicio: ontem, fim: ontem }
    }
    case 'ultimos_7_dias':
      return { inicio: adicionarDias(h, -6), fim: h }
    case 'ultimos_30_dias':
      return { inicio: adicionarDias(h, -29), fim: h }
    case 'mes_atual':
      return { inicio: new Date(h.getFullYear(), h.getMonth(), 1), fim: h }
    case 'mes_anterior': {
      const inicio = new Date(h.getFullYear(), h.getMonth() - 1, 1)
      const fim = new Date(h.getFullYear(), h.getMonth(), 0)
      return { inicio, fim }
    }
    case 'este_ano':
      return { inicio: new Date(h.getFullYear(), 0, 1), fim: h }
    case 'personalizado':
      return { inicio: h, fim: h }
  }
}

/** Dado um range e um modo, calcula o range de comparação (seção 4.3). */
export function obterRangeComparacao(range: RangeData, modo: ModoComparacao): RangeData | null {
  if (modo === 'sem_comparacao') return null

  const duracaoDias = Math.round((range.fim.getTime() - range.inicio.getTime()) / 86_400_000)

  if (modo === 'periodo_anterior') {
    const fim = adicionarDias(range.inicio, -1)
    const inicio = adicionarDias(fim, -duracaoDias)
    return { inicio, fim }
  }

  if (modo === 'mes_anterior_equivalente') {
    // Mesma quantidade de dias corridos do mês, começando no dia 1 do mês anterior.
    const mesAnterior = new Date(range.inicio.getFullYear(), range.inicio.getMonth() - 1, 1)
    return { inicio: mesAnterior, fim: adicionarDias(mesAnterior, duracaoDias) }
  }

  if (modo === 'ano_anterior_equivalente') {
    const inicio = new Date(range.inicio.getFullYear() - 1, range.inicio.getMonth(), range.inicio.getDate())
    const fim = new Date(range.fim.getFullYear() - 1, range.fim.getMonth(), range.fim.getDate())
    return { inicio, fim }
  }

  return null
}

/** Range padrão do dashboard ao carregar (seção 1/3): mês atual até hoje, comparado
 * automaticamente com o mesmo intervalo de dias do mês anterior. */
export function rangePadrao(hoje: Date = new Date()) {
  const atual = obterRangePreset('mes_atual', hoje)
  const comparacao = obterRangeComparacao(atual, 'mes_anterior_equivalente')!
  return { atual, comparacao }
}

export function formatarRangeParaAPI(range: RangeData): { data_inicial: string; data_final: string } {
  return { data_inicial: toISODate(range.inicio), data_final: toISODate(range.fim) }
}
