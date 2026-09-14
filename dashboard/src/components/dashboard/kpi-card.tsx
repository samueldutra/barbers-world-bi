import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatarVariacao } from '@/lib/formatters'
import { cn } from 'cn'

interface KpiCardProps {
  titulo: string
  tooltip: string
  valorFormatado: string
  atual: number
  anterior: number
  comComparacao: boolean
  anteriorFormatado: string
}

export function KpiCard({ titulo, tooltip, valorFormatado, atual, anterior, comComparacao, anteriorFormatado }: KpiCardProps) {
  const { percentual, direcao } = formatarVariacao(atual, anterior)

  return (
    <Card>
      <CardHeader className="pb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="text-sm font-medium text-muted-foreground w-fit cursor-help underline decoration-dotted underline-offset-4">
              {titulo}
            </p>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{tooltip}</TooltipContent>
        </Tooltip>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-2xl font-semibold tabular-nums">{valorFormatado}</p>
        {comComparacao ? (
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium',
                direcao === 'up' && 'text-emerald-600 dark:text-emerald-400',
                direcao === 'down' && 'text-red-600 dark:text-red-400',
                direcao === 'flat' && 'text-muted-foreground'
              )}
            >
              {direcao === 'up' && <ArrowUp className="h-3 w-3" />}
              {direcao === 'down' && <ArrowDown className="h-3 w-3" />}
              {direcao === 'flat' && <Minus className="h-3 w-3" />}
              {percentual >= 0 ? '+' : ''}
              {percentual.toFixed(1)}%
            </span>
            <span className="text-muted-foreground">vs {anteriorFormatado} período anterior</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Sem comparação</p>
        )}
      </CardContent>
    </Card>
  )
}
