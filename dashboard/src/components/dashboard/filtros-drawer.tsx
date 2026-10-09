'use client'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { FiltroCanais } from '@/components/filtros/filtro-canais'
import { FiltroSituacoes } from '@/components/filtros/filtro-situacoes'
import { FiltrosDrawerBase } from '@/components/filtros/filtros-drawer-base'
import { CanalLogo } from '@/components/filtros/canal-logo'
import type { CanalVenda } from '@/hooks/use-canais-venda'
import type { SituacaoPedido } from '@/hooks/use-situacoes-pedido'
import type { AbaCanal } from '@/lib/abas-canais'

interface Props {
  canais: CanalVenda[]
  canaisSelecionados: number[] | null
  onCanaisChange: (ids: number[] | null) => void
  situacoes: SituacaoPedido[]
  situacoesSelecionadas: number[] | null
  onSituacoesChange: (ids: number[] | null) => void
  /** Aba de canal ativa: o filtro de canais fica bloqueado (vale o canal da aba). */
  abaDeCanal?: AbaCanal | null
  /** Padrão de situações da aba ativa (quando tem um próprio). */
  idsPadraoSituacoes?: number[]
}

interface FiltrosDashboard {
  canais: number[] | null
  situacoes: number[] | null
}

/** Filtros do Dashboard (Canais e Situação) no drawer padrão. */
export function FiltrosDrawer({
  canais,
  canaisSelecionados,
  onCanaisChange,
  situacoes,
  situacoesSelecionadas,
  onSituacoesChange,
  abaDeCanal = null,
  idsPadraoSituacoes,
}: Props) {
  return (
    <FiltrosDrawerBase<FiltrosDashboard>
      valor={{ canais: canaisSelecionados, situacoes: situacoesSelecionadas }}
      onAplicar={(novo) => {
        onCanaisChange(novo.canais)
        onSituacoesChange(novo.situacoes)
      }}
      // Com aba de canal ativa o filtro de canais não conta (é definido pela aba).
      contar={(v) => (!abaDeCanal && v.canais && v.canais.length > 0 ? 1 : 0) + (v.situacoes ? 1 : 0)}
    >
      {(rascunho, atualizar) => (
        <>
          <div className="flex flex-col gap-2">
            <Label>Canais</Label>
            {abaDeCanal ? (
              <>
                <Button variant="outline" size="sm" disabled className="w-full justify-start font-normal">
                  <CanalLogo grupo={abaDeCanal.grupo} />
                  {abaDeCanal.label}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Definido pela aba {abaDeCanal.label}. Volte para a aba Geral para filtrar por canal.
                </p>
              </>
            ) : (
              <FiltroCanais
                canais={canais}
                canaisSelecionados={rascunho.canais}
                onCanaisChange={(ids) => atualizar({ canais: ids })}
                className="w-full"
              />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label>Situação</Label>
            <FiltroSituacoes
              situacoes={situacoes}
              situacoesSelecionadas={rascunho.situacoes}
              onSituacoesChange={(ids) => atualizar({ situacoes: ids })}
              idsPadrao={idsPadraoSituacoes}
              className="w-full"
            />
          </div>
        </>
      )}
    </FiltrosDrawerBase>
  )
}
