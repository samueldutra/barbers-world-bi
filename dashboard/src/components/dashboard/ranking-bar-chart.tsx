'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { formatarMoeda, formatarMoedaAbreviada } from '@/lib/formatters'

const chartConfig = {
  faturamento: { label: 'Faturamento', color: 'var(--primary)' },
} satisfies ChartConfig

interface Props<T extends { faturamento: number }> {
  titulo: string
  descricao: string
  dados: T[]
  chaveLabel: keyof T
  onSelecionar?: (item: T) => void
}

export function RankingBarChart<T extends { faturamento: number }>({
  titulo,
  descricao,
  dados,
  chaveLabel,
  onSelecionar,
}: Props<T>) {
  const dadosGrafico = [...dados]
    .sort((a, b) => Number(b.faturamento) - Number(a.faturamento))
    .map((d) => ({ ...d, label: String(d[chaveLabel] ?? '—') }))

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
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <BarChart data={dadosGrafico} layout="vertical" margin={{ left: 12 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v: number) => formatarMoedaAbreviada(v)} />
              <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={110} />
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
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
