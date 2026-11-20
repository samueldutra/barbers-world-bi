'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { tenantSchema } from '@/lib/tenant'
import { formatarRangeParaAPI, type RangeData } from '@/lib/date-ranges'

export interface VendaPorHora {
  hora: number
  faturamento: number
  pedidos: number
  /** Faturamento acumulado de 00:00 até o fim desta hora. */
  acumulado: number
}

interface Args {
  atual: RangeData
  /** Só carrega quando o gráfico está visível. */
  ativo: boolean
  refreshToken?: number
}

/** Vendas da Nuvemshop por hora do dia (0..23) no período, com o acumulado. */
export function useVendasPorHora({ atual, ativo, refreshToken }: Args) {
  const [dados, setDados] = useState<VendaPorHora[]>([])
  const [loading, setLoading] = useState(false)
  const tokenAnterior = useRef(refreshToken)

  useEffect(() => {
    if (!ativo) return
    let vivo = true
    const silencioso = tokenAnterior.current !== refreshToken
    tokenAnterior.current = refreshToken
    if (!silencioso) setLoading(true)
    const { data_inicial, data_final } = formatarRangeParaAPI(atual)
    createClient()
      .rpc('obter_vendas_por_hora', { p_schema_name: tenantSchema(), p_data_inicial: data_inicial, p_data_final: data_final })
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) {
          console.error('Erro ao carregar vendas por hora:', error)
        } else {
          let soma = 0
          setDados(
            ((data as { hora: number; faturamento: number; pedidos: number }[]) ?? []).map((d) => {
              soma += Number(d.faturamento)
              return { hora: d.hora, faturamento: Number(d.faturamento), pedidos: Number(d.pedidos), acumulado: soma }
            })
          )
        }
        setLoading(false)
      })
    return () => {
      vivo = false
    }
  }, [atual, ativo, refreshToken])

  return { dados, loading }
}
