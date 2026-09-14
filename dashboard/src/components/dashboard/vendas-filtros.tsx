'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown, RefreshCw, CalendarIcon } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from 'cn'
import { formatarData } from '@/lib/formatters'
import type { PeriodoPreset, RangeData } from '@/lib/date-ranges'
import type { CanalVenda } from '@/hooks/use-canais-venda'

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
  const [popoverAberto, setPopoverAberto] = useState(false)
  const [calendarioAberto, setCalendarioAberto] = useState(false)
  // Estado local da seleção em andamento no calendário — distinto de rangePersonalizado
  // (que exige início E fim), pra permitir o estado intermediário "só a data inicial
  // escolhida" sem realimentar um range sintético (from === to) de volta ao DayPicker,
  // o que quebraria o segundo clique (reiniciaria a seleção em vez de estender o intervalo).
  const [selecaoEmAndamento, setSelecaoEmAndamento] = useState<DateRange | undefined>(undefined)

  const toggleCanal = (id: number) => {
    const atuais = canaisSelecionados ?? []
    const novo = atuais.includes(id) ? atuais.filter((c) => c !== id) : [...atuais, id]
    onCanaisChange(novo.length === 0 ? null : novo)
  }

  const labelCanais =
    !canaisSelecionados || canaisSelecionados.length === 0
      ? 'Todos os canais'
      : canaisSelecionados.length === 1
        ? canais.find((c) => c.id_loja === canaisSelecionados[0])?.descricao || '1 canal'
        : `${canaisSelecionados.length} canais`

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

      <Popover open={popoverAberto} onOpenChange={setPopoverAberto}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-52 justify-between font-normal">
            {labelCanais}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar canal..." />
            <CommandList>
              <CommandEmpty>Nenhum canal encontrado.</CommandEmpty>
              <CommandGroup>
                <CommandItem onSelect={() => onCanaisChange(null)}>
                  <Check className={cn('mr-2 h-4 w-4', !canaisSelecionados ? 'opacity-100' : 'opacity-0')} />
                  Todos os canais
                </CommandItem>
                {canais.map((canal) => (
                  <CommandItem key={canal.id_loja} onSelect={() => toggleCanal(canal.id_loja)}>
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        canaisSelecionados?.includes(canal.id_loja) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {canal.descricao || `Canal ${canal.id_loja}`}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Button variant="outline" size="sm" onClick={onAtualizar} disabled={atualizando}>
        <RefreshCw className={cn('h-4 w-4', atualizando && 'animate-spin')} />
        Atualizar
      </Button>
    </div>
  )
}
