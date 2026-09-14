'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'

/** Marcas/categorias disponíveis pra filtro — vêm da dimensão produtos inteira (mesmo
 * padrão de use-canais-venda.ts), não do período filtrado. */
export function useFiltrosProdutos() {
  const [marcas, setMarcas] = useState<string[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ativo = true
    const supabase = createClient()

    Promise.all([
      supabase.rpc('obter_marcas_produtos', { p_schema_name: TENANT_SCHEMA }),
      supabase.rpc('obter_categorias_produtos', { p_schema_name: TENANT_SCHEMA }),
    ])
      .then(([marcasRes, categoriasRes]) => {
        if (!ativo) return
        if (marcasRes.error) throw marcasRes.error
        if (categoriasRes.error) throw categoriasRes.error
        setMarcas(((marcasRes.data as { marca: string }[]) ?? []).map((m) => m.marca))
        setCategorias(((categoriasRes.data as { categoria_descricao: string }[]) ?? []).map((c) => c.categoria_descricao))
      })
      .catch((err) => {
        console.error('Erro ao carregar marcas/categorias:', err)
      })
      .finally(() => {
        if (ativo) setLoading(false)
      })

    return () => {
      ativo = false
    }
  }, [])

  return { marcas, categorias, loading }
}
