'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { tenantSchema } from '@/lib/tenant'

export type StatusProposta = 'pendente' | 'aplicado' | 'erro' | 'excluido'

export interface LinhaProposta {
  id_produto: number
  nome: string | null
  preco: number | null
  codigo_atual: string | null
  codigo_proposto: string
  observacao: string | null
  status: StatusProposta
  erro: string | null
  aplicado_em: string | null
  com_vendas: boolean
  total_registros: number
}

export function useResumoPropostas(gatilho: number) {
  const [resumo, setResumo] = useState<Record<string, number>>({})
  useEffect(() => {
    let ativo = true
    const supabase = createClient()
    Promise.resolve(supabase.rpc('obter_resumo_propostas_sku_bling', { p_schema_name: tenantSchema() }))
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) throw error
        const mapa: Record<string, number> = {}
        for (const r of (data as { status: string; quantidade: number }[]) ?? []) mapa[r.status] = Number(r.quantidade)
        setResumo(mapa)
      })
      .catch((err) => console.error('Erro ao carregar o resumo das propostas de SKU:', err))
    return () => {
      ativo = false
    }
  }, [gatilho])
  return resumo
}

export function usePropostasSkuBling(filtros: { status: string; busca: string; pagina: number; tamanhoPagina: number }, gatilho: number) {
  const [linhas, setLinhas] = useState<LinhaProposta[]>([])
  const [totalRegistros, setTotalRegistros] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { status, busca, pagina, tamanhoPagina } = filtros

  useEffect(() => {
    let ativo = true
    setLoading(true)
    setError(null)
    const supabase = createClient()
    // Debounce da busca: evita disparar uma RPC a cada tecla digitada.
    const timer = setTimeout(() => {
      Promise.resolve(
        supabase.rpc('obter_propostas_sku_bling', {
          p_schema_name: tenantSchema(),
          p_status: status,
          p_busca: busca.trim() || null,
          p_pagina: pagina,
          p_tamanho_pagina: tamanhoPagina,
        })
      )
        .then(({ data, error }) => {
          if (!ativo) return
          if (error) throw error
          const linhas = (data as LinhaProposta[]) ?? []
          setLinhas(linhas)
          setTotalRegistros(linhas[0]?.total_registros ?? 0)
        })
        .catch((err) => {
          console.error('Erro ao carregar as propostas de SKU:', err)
          if (ativo) setError('Não foi possível carregar as propostas de SKU.')
        })
        .finally(() => {
          if (ativo) setLoading(false)
        })
    }, 300)
    return () => {
      ativo = false
      clearTimeout(timer)
    }
  }, [status, busca, pagina, tamanhoPagina, gatilho])

  return { linhas, totalRegistros, loading, error }
}

/** Todas as propostas de um status (páginas de 1000 — o limite do Supabase por RPC), pra seleção em massa. */
export async function buscarTodasPropostas(status: string): Promise<LinhaProposta[]> {
  const supabase = createClient()
  const TAMANHO = 1000
  const todas: LinhaProposta[] = []
  for (let pagina = 1; ; pagina++) {
    const { data, error } = await supabase.rpc('obter_propostas_sku_bling', {
      p_schema_name: tenantSchema(),
      p_status: status,
      p_busca: null,
      p_pagina: pagina,
      p_tamanho_pagina: TAMANHO,
    })
    if (error) throw error
    const lote = (data as LinhaProposta[]) ?? []
    todas.push(...lote)
    if (lote.length < TAMANHO) break
  }
  return todas
}
