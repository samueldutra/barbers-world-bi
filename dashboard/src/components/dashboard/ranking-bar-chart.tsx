'use client'

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis, type YAxisTickContentProps } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { formatarMoeda, formatarMoedaAbreviada } from '@/lib/formatters'
import { RotuloValorBarra } from '@/components/dashboard/rotulo-valor-barra'
import { CLASSE_LOGO_CANAL } from '@/lib/canais'
import { useEscalaRem } from '@/hooks/use-escala-rem'

const chartConfig = {
  faturamento: { label: 'Faturamento', color: 'var(--primary)' },
} satisfies ChartConfig

interface Props<T extends { faturamento: number }> {
  titulo: string
  descricao: string
  dados: T[]
  chaveLabel: keyof T
  onSelecionar?: (item: T) => void
  /** URL de um ícone exibido à esquerda do rótulo de cada barra (ex.: logo do canal). */
  iconeDoItem?: (item: T) => string | null
  /** Mostra "R$ valor (x,xx%)" em cada barra — % sobre a soma de todas as barras. */
  mostrarValorEPercentual?: boolean
}

const LARGURA_EIXO_ROTULOS = 130
const TAMANHO_ICONE = 16

export function RankingBarChart<T extends { faturamento: number }>({
  titulo,
  descricao,
  dados,
  chaveLabel,
  onSelecionar,
  iconeDoItem,
  mostrarValorEPercentual,
}: Props<T>) {
  // Medidas em px dentro do SVG não acompanham o rem; a escala mantém tudo proporcional no modo TV.
  const escala = useEscalaRem()
  const larguraEixoRotulos = LARGURA_EIXO_ROTULOS * escala
  const tamanhoIcone = TAMANHO_ICONE * escala
  const dadosGrafico = [...dados]
    .sort((a, b) => Number(b.faturamento) - Number(a.faturamento))
    .map((d) => ({ ...d, label: String(d[chaveLabel] ?? '—'), icone: iconeDoItem?.(d) ?? null }))
  const totalFaturamento = dadosGrafico.reduce((soma, d) => soma + Number(d.faturamento || 0), 0)

  // Rótulo do eixo com ícone: foreignObject pra usar layout HTML (ícone + texto truncado,
  // alinhados à direita como o tick padrão). Sem iconeDoItem, mantém o tick padrão.
  const tickComIcone = iconeDoItem
    ? ({ x, y, index }: YAxisTickContentProps) => {
        const item = dadosGrafico[index]
        return (
          <foreignObject x={Number(x) - larguraEixoRotulos} y={Number(y) - 10 * escala} width={larguraEixoRotulos - 4} height={20 * escala}>
            <div className="flex h-5 items-center justify-end gap-1.5 text-xs text-muted-foreground">
              {item?.icone && (
                // eslint-disable-next-line @next/next/no-img-element -- dentro de <svg>; ícone local pequeno
                <img
                  src={item.icone}
                  alt=""
                  aria-hidden
                  width={tamanhoIcone}
                  height={tamanhoIcone}
                  style={{ width: tamanhoIcone, height: tamanhoIcone }}
                  className={CLASSE_LOGO_CANAL}
                />
              )}
              <span className="truncate">{item?.label}</span>
            </div>
          </foreignObject>
        )
      }
    : undefined

  return (
    <Card>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
        <CardDescription>{descricao}</CardDescription>
      </CardHeader>
      <CardContent>
        {dadosGrafico.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma venda encontrada para este período.
          </p>
        ) : (
          <ChartContainer config={chartConfig} className="h-[17.5rem] w-full">
            <BarChart data={dadosGrafico} layout="vertical" margin={{ left: 12 * escala }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v: number) => formatarMoedaAbreviada(v)} />
              <YAxis
                dataKey="label"
                type="category"
                tickLine={false}
                axisLine={false}
                width={iconeDoItem ? larguraEixoRotulos : 110 * escala}
                tick={tickComIcone}
              />
              <ChartTooltip
                cursor={{ fill: 'var(--muted)' }}
                content={<ChartTooltipContent formatter={(value) => formatarMoeda(Number(value))} />}
              />
              <Bar
                dataKey="faturamento"
                fill="var(--color-faturamento)"
                radius={4}
                className={onSelecionar ? 'cursor-pointer' : undefined}
                onClick={(data) => {
                  if (onSelecionar) onSelecionar(data as unknown as T)
                }}
              >
                {mostrarValorEPercentual && (
                  <LabelList dataKey="faturamento" content={<RotuloValorBarra total={totalFaturamento} />} />
                )}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
