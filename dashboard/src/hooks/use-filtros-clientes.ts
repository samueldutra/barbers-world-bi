'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'

/** Municípios disponíveis pro filtro de cidade — vêm da dimensão contatos inteira (mesmo
 * padrão de use-filtros-produtos.ts), não do período filtrado. */
export function useFiltrosClientes() {
  const [municipios, setMunicipios] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ativo = true
    const supabase = createClient()

    Promise.resolve(supabase.rpc('obter_municipios_clientes', { p_schema_name: TENANT_SCHEMA }))
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) throw error
        setMunicipios(((data as { municipio: string }[]) ?? []).map((d) => d.municipio))
      })
      .catch((err) => console.error('Erro ao carregar municípios:', err))
      .finally(() => {
        if (ativo) setLoading(false)
      })

    return () => {
      ativo = false
    }
  }, [])

  return { municipios, loading }
}
