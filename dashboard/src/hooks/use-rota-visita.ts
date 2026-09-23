'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'
import type { ParadaRota, RotaVisita, StatusRota } from '@/hooks/use-rotas-visita'

/** Uma rota + paradas, pra tela de detalhe (/prospeccao/rotas/[id]). Marcar visita é
 * otimista — no celular, em campo, a resposta do toque não pode esperar a rede. */
export function useRotaVisita(id: number) {
  const [rota, setRota] = useState<RotaVisita | null>(null)
  const [paradas, setParadas] = useState<ParadaRota[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [naoEncontrada, setNaoEncontrada] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    // Não há RPC de rota única — a lista é pequena (rotas do time), então filtra aqui.
    const [rotasRes, paradasRes] = await Promise.all([
      Promise.resolve(supabase.rpc('obter_rotas_visita', { p_schema_name: TENANT_SCHEMA })),
      Promise.resolve(supabase.rpc('obter_rota_visita_paradas', { p_schema_name: TENANT_SCHEMA, p_rota_id: id })),
    ])
    if (rotasRes.error || paradasRes.error) {
      console.error('Erro ao carregar rota:', rotasRes.error ?? paradasRes.error)
      setError('Não foi possível carregar essa rota.')
    } else {
      const encontrada = ((rotasRes.data as RotaVisita[]) ?? []).find((r) => r.id === id) ?? null
      setRota(encontrada)
      setNaoEncontrada(!encontrada)
      setParadas((paradasRes.data as ParadaRota[]) ?? [])
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    carregar()
  }, [carregar])

  const alternarVisita = async (parada: ParadaRota) => {
    const visitada = !parada.visita_realizada
    const aplicar = (v: boolean, visitadoEm: string | null) => {
      setParadas((atual) =>
        atual.map((p) => (p.parada_id === parada.parada_id ? { ...p, visita_realizada: v, visitado_em: visitadoEm } : p))
      )
      setRota((r) => (r ? { ...r, paradas_visitadas: r.paradas_visitadas + (v ? 1 : -1) } : r))
    }
    aplicar(visitada, visitada ? new Date().toISOString() : null)

    const supabase = createClient()
    const { error } = await Promise.resolve(
      supabase.rpc('atualizar_parada_rota_visita', {
        p_schema_name: TENANT_SCHEMA,
        p_parada_id: parada.parada_id,
        p_visita_realizada: visitada,
        p_observacoes: parada.observacoes,
      })
    )
    if (error) {
      aplicar(parada.visita_realizada, parada.visitado_em)
      throw error
    }
  }

  const atualizarStatus = async (status: StatusRota) => {
    const supabase = createClient()
    const { error } = await Promise.resolve(
      supabase.rpc('atualizar_status_rota_visita', { p_schema_name: TENANT_SCHEMA, p_id: id, p_status: status })
    )
    if (error) throw error
    setRota((r) => (r ? { ...r, status } : r))
  }

  const excluir = async () => {
    const supabase = createClient()
    const { error } = await Promise.resolve(supabase.rpc('excluir_rota_visita', { p_schema_name: TENANT_SCHEMA, p_id: id }))
    if (error) throw error
  }

  return { rota, paradas, loading, error, naoEncontrada, recarregar: carregar, alternarVisita, atualizarStatus, excluir }
}
