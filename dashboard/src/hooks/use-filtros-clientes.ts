'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'

/** UFs/municípios disponíveis pra filtro — vêm da dimensão contatos inteira (mesmo
 * padrão de use-filtros-produtos.ts), não do período filtrado. Municípios são
 * restritos pela UF selecionada (filtro em cascata). */
export function useFiltrosClientes(uf: string | null) {
  const [ufs, setUfs] = useState<string[]>([])
  const [municipios, setMunicipios] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ativo = true
    const supabase = createClient()

    Promise.resolve(supabase.rpc('obter_ufs_clientes', { p_schema_name: TENANT_SCHEMA }))
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) throw error
        setUfs(((data as { uf: string }[]) ?? []).map((d) => d.uf))
      })
      .catch((err) => console.error('Erro ao carregar UFs:', err))
      .finally(() => {
        if (ativo) setLoading(false)
      })

    return () => {
      ativo = false
    }
  }, [])

  useEffect(() => {
    let ativo = true
    const supabase = createClient()

    Promise.resolve(supabase.rpc('obter_municipios_clientes', { p_schema_name: TENANT_SCHEMA, p_uf: uf }))
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) throw error
        setMunicipios(((data as { municipio: string }[]) ?? []).map((d) => d.municipio))
      })
      .catch((err) => console.error('Erro ao carregar municípios:', err))

    return () => {
      ativo = false
    }
  }, [uf])

  return { ufs, municipios, loading }
}
