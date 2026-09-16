'use client'

import { useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatarData } from '@/lib/formatters'
import { toISODate, adicionarDias } from '@/lib/date-ranges'

export type UltimaCompraPreset = 'todos' | '15' | '30' | '60' | '90' | '180' | 'personalizado'

const OPCOES: { value: UltimaCompraPreset; label: string }[] = [
  { value: 'todos', label: 'Última compra: qualquer período' },
  { value: '15', label: 'Mais de 15 dias sem comprar' },
  { value: '30', label: 'Mais de 30 dias sem comprar' },
  { value: '60', label: 'Mais de 60 dias sem comprar' },
  { value: '90', label: 'Mais de 90 dias sem comprar' },
  { value: '180', label: 'Mais de 180 dias sem comprar' },
  { value: 'personalizado', label: 'Personalizado...' },
]

/** Converte a seleção (preset de dias ou data personalizada) na data de corte que a RPC
 * espera: clientes cuja última compra foi NESSA data ou antes entram no filtro. */
export function calcularUltimaCompraAntesDe(preset: UltimaCompraPreset, dataPersonalizada: Date | null): string | null {
  if (preset === 'todos') return null
  if (preset === 'personalizado') return dataPersonalizada ? toISODate(dataPersonalizada) : null
  return toISODate(adicionarDias(new Date(), -Number(preset)))
}

interface Props {
  preset: UltimaCompraPreset
  onPresetChange: (p: UltimaCompraPreset) => void
  dataPersonalizada: Date | null
  onDataPersonalizadaChange: (d: Date) => void
}

export function FiltroUltimaCompra({ preset, onPresetChange, dataPersonalizada, onDataPersonalizadaChange }: Props) {
  const [calendarioAberto, setCalendarioAberto] = useState(false)

  return (
    <div className="flex items-center gap-2">
      <Select value={preset} onValueChange={(v) => onPresetChange(v as UltimaCompraPreset)}>
        <SelectTrigger className="w-60" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPCOES.map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {preset === 'personalizado' && (
        <Popover open={calendarioAberto} onOpenChange={setCalendarioAberto}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="justify-start font-normal">
              <CalendarIcon className="h-4 w-4" />
              {dataPersonalizada ? `Sem comprar desde ${formatarData(dataPersonalizada)}` : 'Selecionar data'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dataPersonalizada ?? undefined}
              onSelect={(d) => {
                if (d) {
                  onDataPersonalizadaChange(d)
                  setCalendarioAberto(false)
                }
              }}
              disabled={{ after: new Date() }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
