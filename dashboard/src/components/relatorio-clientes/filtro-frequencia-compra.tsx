'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export type FrequenciaCompraPreset = 'todos' | 'ate_15' | 'ate_30' | 'ate_60' | 'acima_60' | 'personalizado'

const OPCOES: { value: FrequenciaCompraPreset; label: string }[] = [
  { value: 'todos', label: 'Frequência de compra: qualquer' },
  { value: 'ate_15', label: 'Compra a cada 15 dias ou menos' },
  { value: 'ate_30', label: 'Compra a cada 30 dias ou menos' },
  { value: 'ate_60', label: 'Compra a cada 60 dias ou menos' },
  { value: 'acima_60', label: 'Compra a cada mais de 60 dias' },
  { value: 'personalizado', label: 'Personalizado...' },
]

interface FaixaDias {
  min: number | null
  max: number | null
}

/** Converte o preset (ou a faixa personalizada) na faixa mín/máx que a RPC espera —
 * mesmo raciocínio de calcularUltimaCompraAntesDe em filtro-ultima-compra.tsx. */
export function calcularFrequenciaFaixa(preset: FrequenciaCompraPreset, personalizada: FaixaDias): FaixaDias {
  switch (preset) {
    case 'ate_15':
      return { min: null, max: 15 }
    case 'ate_30':
      return { min: null, max: 30 }
    case 'ate_60':
      return { min: null, max: 60 }
    case 'acima_60':
      return { min: 60, max: null }
    case 'personalizado':
      return personalizada
    default:
      return { min: null, max: null }
  }
}

interface Props {
  preset: FrequenciaCompraPreset
  onPresetChange: (p: FrequenciaCompraPreset) => void
  personalizada: FaixaDias
  onPersonalizadaChange: (f: FaixaDias) => void
}

export function FiltroFrequenciaCompra({ preset, onPresetChange, personalizada, onPersonalizadaChange }: Props) {
  return (
    <div className="flex items-center gap-2">
      <Select value={preset} onValueChange={(v) => onPresetChange(v as FrequenciaCompraPreset)}>
        <SelectTrigger className="w-64" size="sm">
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
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="justify-start font-normal">
              {personalizada.min != null || personalizada.max != null
                ? `${personalizada.min ?? 0}–${personalizada.max ?? '∞'} dias`
                : 'Definir faixa (dias)'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Mínimo (dias)
                <Input
                  type="number"
                  min={0}
                  value={personalizada.min ?? ''}
                  onChange={(e) =>
                    onPersonalizadaChange({
                      ...personalizada,
                      min: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Máximo (dias)
                <Input
                  type="number"
                  min={0}
                  value={personalizada.max ?? ''}
                  onChange={(e) =>
                    onPersonalizadaChange({
                      ...personalizada,
                      max: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
