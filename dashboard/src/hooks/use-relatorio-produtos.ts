'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { formatarRangeParaAPI, type RangeData } from '@/lib/date-ranges'

export type OrdenarRelatorioPor = 'valor_vendido' | 'qtde_vendida'
export type OrdenarDirecao = 'asc' | 'desc'

export interface LinhaRelatorioProduto {
  id_produto: number | null
  codigo: string | null
  nome: string | null
  marca: string | null
  categoria_descricao: string | null
  imagem_url: string | null
  unidades_vendidas: number
  faturamento: number
  pedidos: number
  total_registros: number
}

interface Args {
  atual: RangeData
  canais: number[] | null
  busca: string
  marca: string | null
  categoria: string | null
  ordenarPor: OrdenarRelatorioPor
  ordenarDirecao: OrdenarDirecao
  pagina: number
  tamanhoPagina: number
}

export function useRelatorioProdutos({ atual, canais, busca, marca, categoria, ordenarPor, ordenarDirecao, pagina, tamanhoPagina }: Args) {
  const [linhas, setLinhas] = useState<LinhaRelatorioProduto[]>([])
  const [totalRegistros, setTotalRegistros] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gatilho, setGatilho] = useState(0)

  useEffect(() => {
    let ativo = true
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data_inicial, data_final } = formatarRangeParaAPI(atual)

    // Debounce da busca: evita disparar uma RPC a cada tecla digitada.
    const timer = setTimeout(() => {
      Promise.resolve(
        supabase.rpc('obter_relatorio_vendas_produtos', {
          p_schema_name: TENANT_SCHEMA,
          p_data_inicial: data_inicial,
          p_data_final: data_final,
          p_canais: canais,
          p_busca: busca.trim() || null,
          p_marca: marca,
          p_categoria: categoria,
          p_ordenar_por: ordenarPor,
          p_ordenar_direcao: ordenarDirecao,
          p_pagina: pagina,
          p_tamanho_pagina: tamanhoPagina,
        })
      )
        .then(({ data, error }) => {
          if (!ativo) return
          if (error) throw error
          const linhas = (data as LinhaRelatorioProduto[]) ?? []
          setLinhas(linhas)
          setTotalRegistros(linhas[0]?.total_registros ?? 0)
        })
        .catch((err) => {
          console.error('Erro ao carregar relatório de vendas por produto:', err)
          if (ativo) setError('Não foi possível carregar o relatório de vendas por produto.')
        })
        .finally(() => {
          if (ativo) setLoading(false)
        })
    }, 300)

    return () => {
      ativo = false
      clearTimeout(timer)
    }
  }, [atual, canais, busca, marca, categoria, ordenarPor, ordenarDirecao, pagina, tamanhoPagina, gatilho])

  return { linhas, totalRegistros, loading, error, recarregar: () => setGatilho((g) => g + 1) }
}
