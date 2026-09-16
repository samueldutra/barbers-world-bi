/** Formatação de moeda/número/percentual (seção 38 — sempre pt-BR, nunca ad-hoc nos componentes). */

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const numero = new Intl.NumberFormat('pt-BR')
const percentual = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function formatarMoeda(valor: number): string {
  return moeda.format(valor || 0)
}

/** Versão abreviada pra caber em gráficos/eixos: R$ 1,2 mi / R$ 850 mil. */
export function formatarMoedaAbreviada(valor: number): string {
  const abs = Math.abs(valor)
  if (abs >= 1_000_000) return `R$ ${(valor / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (abs >= 1_000) return `R$ ${(valor / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  return formatarMoeda(valor)
}

export function formatarNumero(valor: number): string {
  return numero.format(valor || 0)
}

export function formatarPercentual(valor: number): string {
  return `${percentual.format(valor || 0)}%`
}

export function formatarVariacao(atual: number, anterior: number): { percentual: number; direcao: 'up' | 'down' | 'flat' } {
  if (!anterior) return { percentual: 0, direcao: 'flat' }
  const variacao = ((atual - anterior) / anterior) * 100
  return {
    percentual: variacao,
    direcao: variacao > 0.05 ? 'up' : variacao < -0.05 ? 'down' : 'flat',
  }
}

export function formatarData(data: string | Date): string {
  const d = typeof data === 'string' ? new Date(data + 'T00:00:00') : data
  return d.toLocaleDateString('pt-BR')
}

/** Aniversário mostra só dia/mês — o ano em `data_nascimento` costuma não ser confiável
 * (vem opcional do cadastro no Bling), o que importa aqui é saber quando parabenizar. */
export function formatarAniversario(data: string): string {
  const [, mes, dia] = data.split('-')
  return `${dia}/${mes}`
}

/** Frequência média de compra (dias) — 1 casa decimal, mesmo padrão do valor calculado na RPC. */
export function formatarDias(dias: number): string {
  return `${dias.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`
}

/** Data + hora pra TIMESTAMPTZ (ex.: criado_em) — diferente de formatarData, que espera uma
 * DATE pura ("YYYY-MM-DD") e quebraria com o "T..." que já vem num timestamp completo. */
export function formatarDataHora(data: string): string {
  return new Date(data).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
