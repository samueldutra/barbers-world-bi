'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'

export interface CidadeBusca {
  id_ibge: number
  nome: string
  uf: string
  estado: string
  /** Leads já salvos nessa cidade (cidade + UF). */
  total_leads: number
  /** Preenchida quando o mapeamento COMPLETO da cidade já terminou. */
  mapeada_em: string | null
  /** Status do último mapeamento (pendente | mapeando | concluido | erro), se houver. */
  mapeamento_status: string | null
}

/** Busca cidades do Brasil (todas as 5.571, mesmo sem nenhum lead mapeado) por nome ou UF.
 * Sem texto, lista primeiro as cidades com mais leads. */
export function useBuscaCidades(busca: string, ativo: boolean) {
  const [cidades, setCidades] = useState<CidadeBusca[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!ativo) return
    let atual = true
    setLoading(true)
    // Debounce: evita uma consulta a cada tecla.
    const timer = setTimeout(async () => {
      const supabase = createClient()
      const { data, error } = await Promise.resolve(
        supabase.rpc('buscar_cidades', { p_schema_name: TENANT_SCHEMA, p_busca: busca, p_limite: 40 })
      )
      if (!atual) return
      if (error) {
        console.error('Erro ao buscar cidades:', error)
        setCidades([])
      } else {
        setCidades(
          ((data as CidadeBusca[]) ?? []).map((c) => ({ ...c, total_leads: Number(c.total_leads) }))
        )
      }
      setLoading(false)
    }, 250)
    return () => {
      atual = false
      clearTimeout(timer)
    }
  }, [busca, ativo])

  return { cidades, loading }
}
