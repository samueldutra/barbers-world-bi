'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'

export interface CanalVenda {
  id_loja: number
  descricao: string | null
  grupo: string | null
}

export function useCanaisVenda() {
  const [canais, setCanais] = useState<CanalVenda[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ativo = true
    const supabase = createClient()
    supabase
      .rpc('obter_canais_venda', { p_schema_name: TENANT_SCHEMA })
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) {
          console.error('Erro ao carregar canais de venda:', error)
        } else {
          setCanais((data as CanalVenda[]) ?? [])
        }
        setLoading(false)
      })
    return () => {
      ativo = false
    }
  }, [])

  return { canais, loading }
}
