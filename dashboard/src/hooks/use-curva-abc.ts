'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { formatarRangeParaAPI, type RangeData } from '@/lib/date-ranges'

export type ClasseAbc = 'A' | 'B' | 'C'

export interface CategoriaCurvaAbc {
  categoria_descricao: string
  unidades_vendidas: number
  faturamento: number
  pedidos: number
  percentual_participacao: number
  percentual_acumulado: number
  classe_abc: ClasseAbc
}

interface Args {
  atual: RangeData
  canais: number[] | null
  marca: string | null
  /** Muda a cada atualização automática da tela. */
  refreshToken?: number
}

export function useCurvaAbc({ atual, canais, marca, refreshToken }: Args) {
  const [categorias, setCategorias] = useState<CategoriaCurvaAbc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Muda a cada atualização automática: recarrega sem piscar o carregamento.
  const tokenAnterior = useRef(refreshToken)
  useEffect(() => {
    let ativo = true
    const silencioso = tokenAnterior.current !== refreshToken
    tokenAnterior.current = refreshToken
    if (!silencioso) setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data_inicial, data_final } = formatarRangeParaAPI(atual)

    Promise.resolve(
      supabase.rpc('obter_curva_abc_categorias', {
        p_schema_name: TENANT_SCHEMA,
        p_data_inicial: data_inicial,
        p_data_final: data_final,
        p_canais: canais,
        p_marca: marca,
      })
    )
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) throw error
        setCategorias((data as CategoriaCurvaAbc[]) ?? [])
      })
      .catch((err) => {
        console.error('Erro ao carregar curva ABC por categoria:', err)
        if (ativo) setError('Não foi possível carregar a curva ABC por categoria.')
      })
      .finally(() => {
        if (ativo) setLoading(false)
      })

    return () => {
      ativo = false
    }
  }, [atual, canais, marca, refreshToken])

  return { categorias, loading, error }
}
