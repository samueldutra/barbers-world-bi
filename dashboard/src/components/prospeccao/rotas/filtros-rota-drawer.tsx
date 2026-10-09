'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { FiltrosDrawerBase } from '@/components/filtros/filtros-drawer-base'
import { ORDEM_STATUS, STATUS_LEAD } from '@/lib/leads-status'
import type { StatusLead } from '@/hooks/use-leads-mapeados'

export interface FiltrosRota {
  /** Classificações marcadas; vazio = todas. */
  classificacoes: StatusLead[]
}

export const FILTROS_ROTA_PADRAO: FiltrosRota = { classificacoes: [] }

interface Props {
  valor: FiltrosRota
  onAplicar: (novo: FiltrosRota) => void
}

/** Filtro de Classificação das paradas da rota, no drawer padrão (mesmo do Dashboard). */
export function FiltrosRotaDrawer({ valor, onAplicar }: Props) {
  return (
    <FiltrosDrawerBase<FiltrosRota>
      valor={valor}
      onAplicar={onAplicar}
      contar={(v) => (v.classificacoes.length > 0 ? 1 : 0)}
    >
      {(rascunho, atualizar) => (
        <div className="flex flex-col gap-2">
          <Label>Classificação</Label>
          <div className="flex flex-col gap-1.5">
            {ORDEM_STATUS.map((st) => {
              const marcado = rascunho.classificacoes.includes(st)
              return (
                <div key={st} className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <Checkbox
                    id={`classificacao-${st}`}
                    checked={marcado}
                    onCheckedChange={(v) =>
                      atualizar({
                        classificacoes: v === true
                          ? [...rascunho.classificacoes, st]
                          : rascunho.classificacoes.filter((c) => c !== st),
                      })
                    }
                  />
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: STATUS_LEAD[st].cor }} aria-hidden />
                  <Label htmlFor={`classificacao-${st}`} className="text-sm font-normal">
                    {STATUS_LEAD[st].label}
                  </Label>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">Sem nenhuma marcada, mostra todas as classificações.</p>
        </div>
      )}
    </FiltrosDrawerBase>
  )
}
