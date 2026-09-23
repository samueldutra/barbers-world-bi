'use client'

import Link from 'next/link'
import { CalendarDays, ChevronRight, MapPin, Navigation } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from 'cn'
import { formatarData } from '@/lib/formatters'
import { LABEL_STATUS_ROTA, VARIANTE_STATUS_ROTA, percentualVisitado } from '@/lib/rotas'
import { RotaAcoesMenu } from '@/components/prospeccao/rotas/rota-acoes-menu'
import type { RotaVisita, StatusRota } from '@/hooks/use-rotas-visita'

interface Props {
  rota: RotaVisita
  onAlterarStatus: (status: StatusRota) => Promise<void>
  onExcluir: () => Promise<void>
}

/** Card da listagem: o card inteiro abre a rota (link cobrindo o card); o menu de ações
 * fica por cima (z-10) pra não disparar a navegação. */
export function RotaCard({ rota, onAlterarStatus, onExcluir }: Props) {
  const href = `/prospeccao/rotas/${rota.id}`
  const pct = percentualVisitado(rota)
  const encerrada = rota.status === 'concluida' || rota.status === 'cancelada'

  return (
    <Card
      className={cn(
        'group relative gap-3 p-4 transition-all hover:border-primary/40 hover:shadow-md active:scale-[0.99]',
        encerrada && 'opacity-75'
      )}
    >
      <Link href={href} className="absolute inset-0 rounded-xl" aria-label={`Abrir rota ${rota.nome}`} />

      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-medium leading-snug">{rota.nome}</p>
          {rota.descricao && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{rota.descricao}</p>}
        </div>
        <Badge variant={VARIANTE_STATUS_ROTA[rota.status]} className="shrink-0">
          {LABEL_STATUS_ROTA[rota.status]}
        </Badge>
        <RotaAcoesMenu
          rota={rota}
          onAlterarStatus={onAlterarStatus}
          onExcluir={onExcluir}
          linkAbrir={href}
          className="relative z-10 -mr-2 -mt-1 h-8 w-8 shrink-0"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-sm">
          <span>
            <span className="font-semibold tabular-nums">{rota.paradas_visitadas}</span>
            <span className="text-muted-foreground"> de {rota.total_paradas} visitada(s)</span>
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        <Progress value={pct} className="h-2" />
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Navigation className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{rota.ponto_partida_endereco || 'Partida: Barbers World'}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {rota.total_paradas} parada(s)
          <CalendarDays className="ml-2 h-3.5 w-3.5 shrink-0" />
          {formatarData(new Date(rota.criado_em))}
        </span>
      </div>

      <div className="flex items-center justify-end text-xs font-medium text-primary">
        Abrir rota
        <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Card>
  )
}
