'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { formatarRangeParaAPI, type RangeData } from '@/lib/date-ranges'

export type OrdenarRankingPor = 'faturamento' | 'unidades' | 'pedidos'

export interface ProdutoRanking {
  id_produto: number | null
  codigo: string | null
  nome: string | null
  marca: string | null
  categoria_descricao: string | null
  imagem_url: string | null
  unidades_vendidas: number
  faturamento: number
  pedidos: number
}

export interface VendaPorAgrupador {
  faturamento: number
  unidades_vendidas: number
  pedidos: number
}

export interface VendaPorCategoria extends VendaPorAgrupador {
  categoria_descricao: string
}

export interface VendaPorMarca extends VendaPorAgrupador {
  marca: string
}

interface Args {
  atual: RangeData
  canais: number[] | null
  ordenarPor: OrdenarRankingPor
}

export function useRankingProdutos({ atual, canais, ordenarPor }: Args) {
  const [ranking, setRanking] = useState<ProdutoRanking[]>([])
  const [porCategoria, setPorCategoria] = useState<VendaPorCategoria[]>([])
  const [porMarca, setPorMarca] = useState<VendaPorMarca[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data_inicial, data_final } = formatarRangeParaAPI(atual)

    Promise.all([
      supabase.rpc('obter_ranking_produtos', {
        p_schema_name: TENANT_SCHEMA,
        p_data_inicial: data_inicial,
        p_data_final: data_final,
        p_canais: canais,
        p_ordenar_por: ordenarPor,
        p_limite: 10,
      }),
      supabase.rpc('obter_vendas_por_categoria', {
        p_schema_name: TENANT_SCHEMA,
        p_data_inicial: data_inicial,
        p_data_final: data_final,
        p_canais: canais,
      }),
      supabase.rpc('obter_vendas_por_marca', {
        p_schema_name: TENANT_SCHEMA,
        p_data_inicial: data_inicial,
        p_data_final: data_final,
        p_canais: canais,
      }),
    ])
      .then(([rankingRes, categoriaRes, marcaRes]) => {
        if (!ativo) return
        if (rankingRes.error) throw rankingRes.error
        if (categoriaRes.error) throw categoriaRes.error
        if (marcaRes.error) throw marcaRes.error
        setRanking((rankingRes.data as ProdutoRanking[]) ?? [])
        setPorCategoria((categoriaRes.data as VendaPorCategoria[]) ?? [])
        setPorMarca((marcaRes.data as VendaPorMarca[]) ?? [])
      })
      .catch((err) => {
        console.error('Erro ao carregar ranking de produtos:', err)
        if (ativo) setError('Não foi possível carregar produtos/categorias/marcas.')
      })
      .finally(() => {
        if (ativo) setLoading(false)
      })

    return () => {
      ativo = false
    }
  }, [atual, canais, ordenarPor])

  return { ranking, porCategoria, porMarca, loading, error }
}
