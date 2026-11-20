'use client'

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { formatarMoeda, formatarMoedaAbreviada } from '@/lib/formatters'
import { useEscalaRem } from '@/hooks/use-escala-rem'
import type { VendaPorHora } from '@/hooks/use-vendas-por-hora'

const chartConfig = {
  faturamento: { label: 'Vendas na hora', color: 'var(--muted-foreground)' },
  acumulado: { label: 'Acumulado', color: 'var(--primary)' },
} satisfies ChartConfig

const rotuloHora = (h: number) => `${String(h).padStart(2, '0')}:00`

export function VendasPorHoraChart({ dados, loading }: { dados: VendaPorHora[]; loading: boolean }) {
  const escala = useEscalaRem()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendas por horário</CardTitle>
        <CardDescription>
          Pedidos da Nuvemshop por hora do dia (00:00 às 23:00, horário de Brasília), com o acumulado no período
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {loading ? (
          <Skeleton className="h-[17.5rem] w-full" />
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[17.5rem] w-full">
            <ComposedChart data={dados}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="hora" tickLine={false} axisLine={false} tickMargin={8} interval={1} tickFormatter={(h: number) => rotuloHora(h)} />
              <YAxis tickLine={false} axisLine={false} tickFormatter={(v: number) => formatarMoedaAbreviada(v)} width={70 * escala} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, itens) => {
                      const h = itens?.[0]?.payload?.hora
                      return typeof h === 'number' ? rotuloHora(h) : ''
                    }}
                    formatter={(value) => formatarMoeda(Number(value))}
                  />
                }
              />
              <Bar dataKey="faturamento" fill="var(--color-faturamento)" fillOpacity={0.45} radius={[3, 3, 0, 0]} />
              <Line dataKey="acumulado" type="monotone" stroke="var(--color-acumulado)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
