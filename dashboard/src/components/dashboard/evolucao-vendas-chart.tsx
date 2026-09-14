'use client'

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { formatarMoeda, formatarMoedaAbreviada, formatarData } from '@/lib/formatters'
import type { EvolucaoComparada } from '@/hooks/use-vendas-dashboard'

const chartConfig = {
  faturamentoAtual: { label: 'Período atual', color: 'var(--primary)' },
  faturamentoComparacao: { label: 'Período anterior', color: 'var(--muted-foreground)' },
} satisfies ChartConfig

export function EvolucaoVendasChart({ dados, comComparacao }: { dados: EvolucaoComparada[]; comComparacao: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Evolução de vendas</CardTitle>
        <CardDescription>Faturamento diário do período{comComparacao ? ' comparado ao anterior' : ''}</CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
          <LineChart data={dados}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="dataAtual"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={(value: string) => (value ? formatarData(value).slice(0, 5) : '')}
            />
            <YAxis tickLine={false} axisLine={false} tickFormatter={(v: number) => formatarMoedaAbreviada(v)} width={70} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => (typeof value === 'string' && value ? formatarData(value) : '')}
                  formatter={(value) => formatarMoeda(Number(value))}
                />
              }
            />
            <Line dataKey="faturamentoAtual" type="monotone" stroke="var(--color-faturamentoAtual)" strokeWidth={2} dot={false} />
            {comComparacao && (
              <Line
                dataKey="faturamentoComparacao"
                type="monotone"
                stroke="var(--color-faturamentoComparacao)"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
            )}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
