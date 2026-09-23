'use client'

import { forwardRef } from 'react'
import { Check, Navigation, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from 'cn'
import { formatarDataHora } from '@/lib/formatters'
import { montarUrlNavegacao } from '@/lib/google-maps-route'
import type { ParadaRota } from '@/hooks/use-rotas-visita'

interface Props {
  parada: ParadaRota
  ordem: number
  proxima: boolean
  destacada: boolean
  onAlternarVisita: () => void
}

/** Parada da rota, pensada pro uso em campo no celular: alvo de toque grande pra marcar a
 * visita, e atalhos de ligar/navegar que abrem os apps do telefone. */
export const ParadaItem = forwardRef<HTMLLIElement, Props>(function ParadaItem(
  { parada, ordem, proxima, destacada, onAlternarVisita },
  ref
) {
  const visitada = parada.visita_realizada
  const telefone = parada.telefone?.replace(/[^\d+]/g, '')

  return (
    <li
      ref={ref}
      className={cn(
        'flex gap-3 rounded-lg border bg-card p-3 transition-all duration-300',
        visitada && 'bg-muted/40',
        proxima && 'border-amber-400 ring-1 ring-amber-400/40',
        destacada && 'ring-2 ring-primary'
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white transition-colors',
          visitada ? 'bg-green-600' : proxima ? 'bg-amber-500' : 'bg-primary'
        )}
      >
        {visitada ? <Check className="h-4 w-4" /> : ordem}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <p className={cn('min-w-0 flex-1 font-medium leading-snug', visitada && 'text-muted-foreground line-through')}>
              {parada.nome}
            </p>
            {proxima && (
              <Badge variant="outline" className="shrink-0 border-amber-400 text-amber-600 dark:text-amber-400">
                Próxima
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[parada.endereco, parada.cidade].filter(Boolean).join(' · ') || 'Sem endereço'}
          </p>
          {visitada && parada.visitado_em && (
            <p className="mt-0.5 text-xs text-green-700 dark:text-green-400">Visitado em {formatarDataHora(parada.visitado_em)}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={visitada ? 'secondary' : 'default'}
            onClick={onAlternarVisita}
            className="h-9 min-w-28"
            aria-pressed={visitada}
          >
            <Check className="h-4 w-4" />
            {visitada ? 'Visitado' : 'Marcar visita'}
          </Button>
          <Button size="sm" variant="outline" className="h-9" asChild>
            <a href={montarUrlNavegacao(parada.latitude, parada.longitude)} target="_blank" rel="noopener noreferrer">
              <Navigation className="h-4 w-4" />
              Navegar
            </a>
          </Button>
          {telefone && (
            <Button size="sm" variant="outline" className="h-9" asChild>
              <a href={`tel:${telefone}`}>
                <Phone className="h-4 w-4" />
                Ligar
              </a>
            </Button>
          )}
        </div>
      </div>
    </li>
  )
})
