'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'

export type StatusConferencia = 'todos' | 'divergentes' | 'alterados'
export type OrdenarConferenciaPor =
  | 'nome'
  | 'preco_atual'
  | 'preco_ultima_venda'
  | 'diferenca_percentual'
  | 'data_ultima_venda'
  | 'data_alteracao_preco'
export type OrdenarDirecao = 'asc' | 'desc'

export interface LinhaConferencia {
  id_produto: number
  codigo: string | null
  nome: string | null
  marca: string | null
  categoria_descricao: string | null
  imagem_url: string | null
  preco_atual: number | null
  preco_anterior: number | null
  data_alteracao_preco: string | null
  /** Preço cheio da última venda (antes do desconto do item) — a referência pra alteração. */
  preco_ultima_venda: number | null
  valor_pago_ultima_venda: number | null
  desconto_ultima_venda: number | null
  data_ultima_venda: string | null
  numero_pedido_ultima_venda: number | null
  canal_ultima_venda: string | null
  diferenca_percentual: number | null
  total_registros: number
}

export interface FiltrosConferencia {
  canais: number[] | null
  descricao: string
  sku: string
  marca: string | null
  categoria: string | null
  status: StatusConferencia
  ordenarPor: OrdenarConferenciaPor
  ordenarDirecao: OrdenarDirecao
  pagina: number
  tamanhoPagina: number
}

export function parametrosConferencia(f: FiltrosConferencia) {
  return {
    p_schema_name: TENANT_SCHEMA,
    p_canais: f.canais,
    p_descricao: f.descricao.trim() || null,
    p_sku: f.sku.trim() || null,
    p_marca: f.marca,
    p_categoria: f.categoria,
    p_status: f.status,
    p_ordenar_por: f.ordenarPor,
    p_ordenar_direcao: f.ordenarDirecao,
    p_pagina: f.pagina,
    p_tamanho_pagina: f.tamanhoPagina,
  }
}

export function useConferenciaPrecos(filtros: FiltrosConferencia) {
  const [linhas, setLinhas] = useState<LinhaConferencia[]>([])
  const [totalRegistros, setTotalRegistros] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gatilho, setGatilho] = useState(0)

  const { canais, descricao, sku, marca, categoria, status, ordenarPor, ordenarDirecao, pagina, tamanhoPagina } = filtros

  useEffect(() => {
    let ativo = true
    setLoading(true)
    setError(null)
    const supabase = createClient()

    // Debounce da busca: evita disparar uma RPC a cada tecla digitada.
    const timer = setTimeout(() => {
      Promise.resolve(
        supabase.rpc(
          'obter_conferencia_precos',
          parametrosConferencia({ canais, descricao, sku, marca, categoria, status, ordenarPor, ordenarDirecao, pagina, tamanhoPagina })
        )
      )
        .then(({ data, error }) => {
          if (!ativo) return
          if (error) throw error
          const linhas = (data as LinhaConferencia[]) ?? []
          setLinhas(linhas)
          setTotalRegistros(linhas[0]?.total_registros ?? 0)
        })
        .catch((err) => {
          console.error('Erro ao carregar conferência de preços:', err)
          if (ativo) setError('Não foi possível carregar a conferência de preços.')
        })
        .finally(() => {
          if (ativo) setLoading(false)
        })
    }, 300)

    return () => {
      ativo = false
      clearTimeout(timer)
    }
  }, [canais, descricao, sku, marca, categoria, status, ordenarPor, ordenarDirecao, pagina, tamanhoPagina, gatilho])

  return { linhas, totalRegistros, loading, error, recarregar: () => setGatilho((g) => g + 1) }
}
