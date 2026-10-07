'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { formatarRangeParaAPI, type RangeData } from '@/lib/date-ranges'

export interface SituacaoPedido {
  id_situacao: number
  nome: string
  cor: string | null
  nome_herdado: string | null
  /** Faz parte do filtro padrão do dashboard (situacoes_padrao_dashboard() no banco). */
  padrao: boolean
  /** Conta como cancelamento (KPI "Cancelamentos"). */
  cancelamento: boolean
  pedidos_periodo: number
  valor_periodo: number
}

interface Args {
  atual: RangeData
  canais: number[] | null
}

/** Todas as situações de pedido já vistas, com volume no período/canais filtrados. */
export function useSituacoesPedido({ atual, canais }: Args) {
  const [situacoes, setSituacoes] = useState<SituacaoPedido[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ativo = true
    setLoading(true)
    const supabase = createClient()
    const { data_inicial, data_final } = formatarRangeParaAPI(atual)
    supabase
      .rpc('obter_situacoes_pedido', {
        p_schema_name: TENANT_SCHEMA,
        p_data_inicial: data_inicial,
        p_data_final: data_final,
        p_canais: canais,
      })
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) {
          console.error('Erro ao carregar situações de pedido:', error)
        } else {
          setSituacoes(
            ((data as SituacaoPedido[]) ?? []).map((s) => ({
              ...s,
              pedidos_periodo: Number(s.pedidos_periodo),
              valor_periodo: Number(s.valor_periodo),
            }))
          )
        }
        setLoading(false)
      })
    return () => {
      ativo = false
    }
  }, [atual, canais])

  return { situacoes, loading }
}
