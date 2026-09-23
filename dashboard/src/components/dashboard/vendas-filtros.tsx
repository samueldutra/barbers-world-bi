'use client'

import { useState } from 'react'
import { RefreshCw, CalendarIcon } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from 'cn'
import { formatarData } from '@/lib/formatters'
import type { PeriodoPreset, RangeData } from '@/lib/date-ranges'
import type { CanalVenda } from '@/hooks/use-canais-venda'
import { FiltroCanais } from '@/components/filtros/filtro-canais'

const OPCOES_PERIODO: { value: PeriodoPreset; label: string }[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: 'ultimos_7_dias', label: 'Últimos 7 dias' },
  { value: 'ultimos_30_dias', label: 'Últimos 30 dias' },
  { value: 'mes_atual', label: 'Mês atual' },
  { value: 'mes_anterior', label: 'Mês anterior' },
  { value: 'este_ano', label: 'Este ano' },
  { value: 'personalizado', label: 'Personalizar...' },
]

interface Props {
  periodo: PeriodoPreset
  onPeriodoChange: (p: PeriodoPreset) => void
  rangePersonalizado: RangeData | null
  onRangePersonalizadoChange: (r: RangeData) => void
  canais: CanalVenda[]
  canaisSelecionados: number[] | null
  onCanaisChange: (ids: number[] | null) => void
  onAtualizar: () => void
  atualizando: boolean
}

export function VendasFiltros({
  periodo,
  onPeriodoChange,
  rangePersonalizado,
  onRangePersonalizadoChange,
  canais,
  canaisSelecionados,
  onCanaisChange,
  onAtualizar,
  atualizando,
}: Props) {
  const [calendarioAberto, setCalendarioAberto] = useState(false)
  // Estado local da seleção em andamento no calendário — distinto de rangePersonalizado
  // (que exige início E fim), pra permitir o estado intermediário "só a data inicial
  // escolhida" sem realimentar um range sintético (from === to) de volta ao DayPicker,
  // o que quebraria o segundo clique (reiniciaria a seleção em vez de estender o intervalo).
  const [selecaoEmAndamento, setSelecaoEmAndamento] = useState<DateRange | undefined>(undefined)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={periodo} onValueChange={(v) => onPeriodoChange(v as PeriodoPreset)}>
        <SelectTrigger className="w-44" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPCOES_PERIODO.map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {periodo === 'personalizado' && (
        <Popover
          open={calendarioAberto}
          onOpenChange={(aberto) => {
            setCalendarioAberto(aberto)
            if (aberto) {
              setSelecaoEmAndamento(
                rangePersonalizado ? { from: rangePersonalizado.inicio, to: rangePersonalizado.fim } : undefined
              )
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="justify-start font-normal">
              <CalendarIcon className="h-4 w-4" />
              {rangePersonalizado
                ? `${formatarData(rangePersonalizado.inicio)} – ${formatarData(rangePersonalizado.fim)}`
                : 'Selecionar datas'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              numberOfMonths={2}
              defaultMonth={rangePersonalizado?.inicio}
              selected={selecaoEmAndamento}
              onSelect={setSelecaoEmAndamento}
              disabled={{ after: new Date() }}
            />
            <div className="flex items-center justify-end gap-2 border-t p-3">
              <Button
                size="sm"
                disabled={!selecaoEmAndamento?.from || !selecaoEmAndamento?.to}
                onClick={() => {
                  if (!selecaoEmAndamento?.from || !selecaoEmAndamento?.to) return
                  onRangePersonalizadoChange({ inicio: selecaoEmAndamento.from, fim: selecaoEmAndamento.to })
                  setCalendarioAberto(false)
                }}
              >
                Aplicar
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      <FiltroCanais canais={canais} canaisSelecionados={canaisSelecionados} onCanaisChange={onCanaisChange} />

      <Button variant="outline" size="sm" onClick={onAtualizar} disabled={atualizando}>
        <RefreshCw className={cn('h-4 w-4', atualizando && 'animate-spin')} />
        Atualizar
      </Button>
    </div>
  )
}
