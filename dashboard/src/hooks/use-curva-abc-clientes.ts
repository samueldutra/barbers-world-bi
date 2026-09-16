'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { formatarRangeParaAPI, type RangeData } from '@/lib/date-ranges'
import type { ClasseAbc } from '@/hooks/use-curva-abc'

export interface ClienteCurvaAbc {
  id_contato: number | null
  nome_contato: string | null
  documento_contato: string | null
  total_pedidos: number
  faturamento: number
  percentual_participacao: number
  percentual_acumulado: number
  classe_abc: ClasseAbc
}

interface Args {
  atual: RangeData
  canais: number[] | null
  cidade: string | null
  limite?: number
}

export function useCurvaAbcClientes({ atual, canais, cidade, limite = 50 }: Args) {
  const [clientes, setClientes] = useState<ClienteCurvaAbc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data_inicial, data_final } = formatarRangeParaAPI(atual)

    Promise.resolve(
      supabase.rpc('obter_curva_abc_clientes', {
        p_schema_name: TENANT_SCHEMA,
        p_data_inicial: data_inicial,
        p_data_final: data_final,
        p_canais: canais,
        p_cidade: cidade,
        p_limite: limite,
      })
    )
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) throw error
        setClientes((data as ClienteCurvaAbc[]) ?? [])
      })
      .catch((err) => {
        console.error('Erro ao carregar curva ABC de clientes:', err)
        if (ativo) setError('Não foi possível carregar a curva ABC de clientes.')
      })
      .finally(() => {
        if (ativo) setLoading(false)
      })

    return () => {
      ativo = false
    }
  }, [atual, canais, cidade, limite])

  return { clientes, loading, error }
}
