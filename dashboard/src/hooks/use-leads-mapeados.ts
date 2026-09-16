'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'

export type StatusLead = 'cliente' | 'concorrente' | 'lead' | 'pendente'

export interface LeadMapeado {
  id: number
  origem_tipo: string | null
  origem_id: string | null
  nome: string
  nicho: string | null
  endereco: string | null
  cidade: string | null
  telefone: string | null
  latitude: number
  longitude: number
  status: StatusLead
  observacoes: string | null
  criado_em: string
  atualizado_em: string
}

interface SalvarInput {
  nome: string
  latitude: number
  longitude: number
  origemTipo?: string | null
  origemId?: string | null
  nicho?: string | null
  endereco?: string | null
  cidade?: string | null
  telefone?: string | null
  status: StatusLead
  observacoes?: string | null
}

export function useLeadsMapeados() {
  const [leads, setLeads] = useState<LeadMapeado[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error } = await Promise.resolve(
      supabase.rpc('obter_leads_mapeados', { p_schema_name: TENANT_SCHEMA, p_status: null })
    )
    if (error) {
      console.error('Erro ao carregar leads mapeados:', error)
      setError('Não foi possível carregar os leads salvos.')
    } else {
      setLeads((data as LeadMapeado[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  const salvar = async (input: SalvarInput) => {
    const supabase = createClient()
    const { error } = await Promise.resolve(
      supabase.rpc('salvar_lead_mapeado', {
        p_schema_name: TENANT_SCHEMA,
        p_nome: input.nome,
        p_latitude: input.latitude,
        p_longitude: input.longitude,
        p_origem_tipo: input.origemTipo ?? null,
        p_origem_id: input.origemId ?? null,
        p_nicho: input.nicho ?? null,
        p_endereco: input.endereco ?? null,
        p_cidade: input.cidade ?? null,
        p_telefone: input.telefone ?? null,
        p_status: input.status,
        p_observacoes: input.observacoes ?? null,
      })
    )
    if (error) throw error
    await carregar()
  }

  const atualizarStatus = async (id: number, status: StatusLead) => {
    const supabase = createClient()
    const { error } = await Promise.resolve(
      supabase.rpc('atualizar_status_lead_mapeado', {
        p_schema_name: TENANT_SCHEMA,
        p_id: id,
        p_status: status,
      })
    )
    if (error) throw error
    await carregar()
  }

  const excluir = async (id: number) => {
    const supabase = createClient()
    const { error } = await Promise.resolve(
      supabase.rpc('excluir_lead_mapeado', { p_schema_name: TENANT_SCHEMA, p_id: id })
    )
    if (error) throw error
    await carregar()
  }

  return { leads, loading, error, recarregar: carregar, salvar, atualizarStatus, excluir }
}
