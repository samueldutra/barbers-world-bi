'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { FiltroCanais } from '@/components/filtros/filtro-canais'
import { FiltroSelecaoUnica } from '@/components/filtros/filtro-selecao-unica'
import { FiltrosDrawerBase } from '@/components/filtros/filtros-drawer-base'
import { FiltroUltimaCompra, type UltimaCompraPreset } from '@/components/relatorio-clientes/filtro-ultima-compra'
import { FiltroFrequenciaCompra, type FrequenciaCompraPreset } from '@/components/relatorio-clientes/filtro-frequencia-compra'
import type { CanalVenda } from '@/hooks/use-canais-venda'

export interface FiltrosClientes {
  canais: number[] | null
  cidade: string | null
  ultimaCompraPreset: UltimaCompraPreset
  dataPersonalizadaUltimaCompra: Date | null
  frequenciaPreset: FrequenciaCompraPreset
  frequenciaPersonalizada: { min: number | null; max: number | null }
  incluirSemVenda: boolean
}

interface Props {
  valor: FiltrosClientes
  onAplicar: (novo: FiltrosClientes) => void
  canais: CanalVenda[]
  municipios: string[]
}

/** Filtros do relatório de clientes (Canais, Cidade, Última compra, Frequência, clientes sem
 * venda) no drawer padrão. */
export function FiltrosClientesDrawer({ valor, onAplicar, canais, municipios }: Props) {
  return (
    <FiltrosDrawerBase<FiltrosClientes>
      valor={valor}
      onAplicar={onAplicar}
      contar={(v) =>
        (v.canais && v.canais.length > 0 ? 1 : 0) +
        (v.cidade ? 1 : 0) +
        (v.ultimaCompraPreset !== 'todos' ? 1 : 0) +
        (v.frequenciaPreset !== 'todos' ? 1 : 0) +
        (v.incluirSemVenda ? 0 : 1)
      }
    >
      {(rascunho, atualizar) => (
        <>
          <div className="flex flex-col gap-2">
            <Label>Canais</Label>
            <FiltroCanais
              canais={canais}
              canaisSelecionados={rascunho.canais}
              onCanaisChange={(ids) => atualizar({ canais: ids })}
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Cidade</Label>
            <FiltroSelecaoUnica
              label="Cidade"
              opcoes={municipios}
              valor={rascunho.cidade}
              onValorChange={(v) => atualizar({ cidade: v })}
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Última compra</Label>
            <FiltroUltimaCompra
              preset={rascunho.ultimaCompraPreset}
              onPresetChange={(p) => atualizar({ ultimaCompraPreset: p })}
              dataPersonalizada={rascunho.dataPersonalizadaUltimaCompra}
              onDataPersonalizadaChange={(d) => atualizar({ dataPersonalizadaUltimaCompra: d })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Frequência de compra</Label>
            <FiltroFrequenciaCompra
              preset={rascunho.frequenciaPreset}
              onPresetChange={(p) => atualizar({ frequenciaPreset: p })}
              personalizada={rascunho.frequenciaPersonalizada}
              onPersonalizadaChange={(f) => atualizar({ frequenciaPersonalizada: f })}
            />
          </div>
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <Checkbox
              id="incluir-sem-venda"
              checked={rascunho.incluirSemVenda}
              onCheckedChange={(v) => atualizar({ incluirSemVenda: v === true })}
            />
            <Label htmlFor="incluir-sem-venda" className="text-sm font-normal">
              Filtrar clientes sem venda
            </Label>
          </div>
        </>
      )}
    </FiltrosDrawerBase>
  )
}
