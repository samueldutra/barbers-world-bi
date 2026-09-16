'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'
import type { StatusLead } from '@/hooks/use-leads-mapeados'

export type StatusRota = 'planejada' | 'em_andamento' | 'concluida' | 'cancelada'

export interface RotaVisita {
  id: number
  nome: string
  descricao: string | null
  status: StatusRota
  total_paradas: number
  paradas_visitadas: number
  criado_em: string
  atualizado_em: string
}

export interface ParadaRota {
  parada_id: number
  lead_id: number
  ordem: number
  visita_realizada: boolean
  visitado_em: string | null
  observacoes: string | null
  nome: string
  endereco: string | null
  cidade: string | null
  telefone: string | null
  latitude: number
  longitude: number
  status_lead: StatusLead
}

export function useRotasVisita() {
  const [rotas, setRotas] = useState<RotaVisita[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error } = await Promise.resolve(supabase.rpc('obter_rotas_visita', { p_schema_name: TENANT_SCHEMA }))
    if (error) {
      console.error('Erro ao carregar rotas de visita:', error)
      setError('Não foi possível carregar as rotas salvas.')
    } else {
      setRotas((data as RotaVisita[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  const salvar = async (nome: string, leadIds: number[], descricao?: string | null) => {
    const supabase = createClient()
    const { data, error } = await Promise.resolve(
      supabase.rpc('salvar_rota_visita', {
        p_schema_name: TENANT_SCHEMA,
        p_nome: nome,
        p_lead_ids: leadIds,
        p_descricao: descricao ?? null,
      })
    )
    if (error) throw error
    await carregar()
    return data as number
  }

  const carregarParadas = async (rotaId: number) => {
    const supabase = createClient()
    const { data, error } = await Promise.resolve(
      supabase.rpc('obter_rota_visita_paradas', { p_schema_name: TENANT_SCHEMA, p_rota_id: rotaId })
    )
    if (error) throw error
    return (data as ParadaRota[]) ?? []
  }

  const atualizarStatus = async (id: number, status: StatusRota) => {
    const supabase = createClient()
    const { error } = await Promise.resolve(
      supabase.rpc('atualizar_status_rota_visita', { p_schema_name: TENANT_SCHEMA, p_id: id, p_status: status })
    )
    if (error) throw error
    await carregar()
  }

  const atualizarParada = async (paradaId: number, visitaRealizada: boolean, observacoes?: string | null) => {
    const supabase = createClient()
    const { error } = await Promise.resolve(
      supabase.rpc('atualizar_parada_rota_visita', {
        p_schema_name: TENANT_SCHEMA,
        p_parada_id: paradaId,
        p_visita_realizada: visitaRealizada,
        p_observacoes: observacoes ?? null,
      })
    )
    if (error) throw error
    await carregar()
  }

  const excluir = async (id: number) => {
    const supabase = createClient()
    const { error } = await Promise.resolve(supabase.rpc('excluir_rota_visita', { p_schema_name: TENANT_SCHEMA, p_id: id }))
    if (error) throw error
    await carregar()
  }

  return { rotas, loading, error, recarregar: carregar, salvar, carregarParadas, atualizarStatus, atualizarParada, excluir }
}
