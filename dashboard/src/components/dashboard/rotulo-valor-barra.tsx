'use client'

import { usePlotArea } from 'recharts'
import { formatarMoeda, formatarMoedaAbreviada } from '@/lib/formatters'

const FONTE_PX = 12
const FOLGA = 6 // espaço entre o fim da barra e o texto (fora) ou a borda da barra (dentro)

let canvasMedida: HTMLCanvasElement | null = null

/** Largura real do texto na fonte do gráfico (canvas) — decide se cabe fora/dentro da barra. */
function medirTexto(texto: string): number {
  if (typeof document === 'undefined') return texto.length * FONTE_PX * 0.6
  canvasMedida ??= document.createElement('canvas')
  const ctx = canvasMedida.getContext('2d')
  if (!ctx) return texto.length * FONTE_PX * 0.6
  ctx.font = `${FONTE_PX}px ${getComputedStyle(document.body).fontFamily}`
  return ctx.measureText(texto).width
}

function formatarPercentual2(valor: number) {
  return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

interface Props {
  /** Soma de todas as barras — base do percentual. */
  total: number
  // Injetados pelo <LabelList> do recharts:
  x?: number | string
  y?: number | string
  width?: number | string
  height?: number | string
  value?: number | string
}

/**
 * Rótulo "R$ 222.163,92 (71,59%)" de uma barra horizontal.
 * Responsivo: tenta o texto completo à direita da barra; se não couber, dentro da barra
 * alinhado à direita; depois as versões curtas (valor abreviado, só %). Cores do tema com
 * contraste ≥ 4,5:1: fora = --foreground sobre o card, dentro = --primary-foreground sobre
 * a barra (--primary).
 */
export function RotuloValorBarra({ total, x, y, width, height, value }: Props) {
  const area = usePlotArea()
  const bx = Number(x), by = Number(y), bw = Number(width), bh = Number(height), v = Number(value)
  if (!area || ![bx, by, bw, bh, v].every(Number.isFinite) || v <= 0) return null

  const pct = total > 0 ? formatarPercentual2((v / total) * 100) : null
  const candidatos = [
    pct ? `${formatarMoeda(v)} (${pct})` : formatarMoeda(v),
    pct ? `${formatarMoedaAbreviada(v)} (${pct})` : formatarMoedaAbreviada(v),
    ...(pct ? [pct] : []),
  ]
  const fimBarra = bx + bw
  const espacoFora = area.x + area.width - fimBarra - FOLGA
  const espacoDentro = bw - 2 * FOLGA
  const cy = by + bh / 2

  for (const texto of candidatos) {
    const largura = medirTexto(texto)
    if (largura <= espacoFora) {
      return (
        <text x={fimBarra + FOLGA} y={cy} dominantBaseline="central" textAnchor="start" fontSize={FONTE_PX}
          className="tabular-nums" style={{ fill: 'var(--foreground)', pointerEvents: 'none' }}>
          {texto}
        </text>
      )
    }
    if (largura <= espacoDentro) {
      return (
        <text x={fimBarra - FOLGA} y={cy} dominantBaseline="central" textAnchor="end" fontSize={FONTE_PX}
          className="tabular-nums" style={{ fill: 'var(--primary-foreground)', fontWeight: 500, pointerEvents: 'none' }}>
          {texto}
        </text>
      )
    }
  }
  return null // nem o % cabe (tela muito estreita) — o valor segue no tooltip
}
