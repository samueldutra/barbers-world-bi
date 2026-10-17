'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'

export type FiltroCatalogo =
  | 'todos'
  | 'sem_codigo'
  | 'sem_marca'
  | 'sem_categoria'
  | 'sem_estoque'
  | 'sem_nuvemshop'
  | 'nuvemshop_despublicado'
  | 'preco_alterado'
  | 'sem_custo'
export type OrdenarCatalogoPor = 'nome' | 'preco' | 'estoque' | 'marca' | 'custo' | 'margem'
export type OrdenarDirecao = 'asc' | 'desc'

/** Um produto ativo do Bling com o estoque e a situação na Nuvemshop (cruzada por SKU). */
export interface ProdutoCatalogo {
  id_produto: number
  codigo: string | null
  nome: string | null
  marca: string | null
  categoria_descricao: string | null
  imagem_url: string | null
  preco: number | null
  /** Custo no Bling (fornecedor.precoCusto); NULL = sem custo cadastrado. */
  preco_custo: number | null
  /** Preço de venda − custo (R$); NULL sem custo. */
  margem_valor: number | null
  /** Margem bruta sobre o preço de venda (%); NULL sem custo. */
  margem_pct: number | null
  preco_anterior: number | null
  data_alteracao_preco: string | null
  saldo_virtual: number | null
  saldo_fisico: number | null
  /** 0 = nenhuma variante da Nuvemshop com o mesmo SKU. */
  ns_variantes: number
  ns_publicado: boolean | null
  /** NULL = estoque sem controle na Nuvemshop. */
  ns_estoque: number | null
  ns_preco: number | null
  ns_url: string | null
  total_registros: number
}

export interface ResumoCatalogo {
  total: number
  sem_codigo: number
  sem_marca: number
  sem_categoria: number
  sem_estoque: number
  sem_nuvemshop: number
  nuvemshop_despublicado: number
  preco_alterado: number
  sem_custo: number
}

export interface FiltrosCatalogo {
  filtro: FiltroCatalogo
  busca: string
  marca: string | null
  categoria: string | null
  ordenarPor: OrdenarCatalogoPor
  ordenarDirecao: OrdenarDirecao
  pagina: number
  tamanhoPagina: number
}

function parametros(f: FiltrosCatalogo) {
  return {
    p_schema_name: TENANT_SCHEMA,
    p_filtro: f.filtro,
    p_busca: f.busca.trim() || null,
    p_marca: f.marca,
    p_categoria: f.categoria,
    p_ordenar_por: f.ordenarPor,
    p_ordenar_direcao: f.ordenarDirecao,
    p_pagina: f.pagina,
    p_tamanho_pagina: f.tamanhoPagina,
  }
}

/** Busca o catálogo inteiro do filtro atual (exportação). */
export async function buscarCatalogoCompleto(f: FiltrosCatalogo, total: number): Promise<ProdutoCatalogo[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc(
    'obter_catalogo_produtos',
    parametros({ ...f, pagina: 1, tamanhoPagina: Math.min(Math.max(total, 1), 20000) })
  )
  if (error) throw error
  return (data as ProdutoCatalogo[]) ?? []
}

export function useCatalogoProdutos(f: FiltrosCatalogo, refreshToken: number) {
  const [linhas, setLinhas] = useState<ProdutoCatalogo[]>([])
  const [totalRegistros, setTotalRegistros] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Muda a cada atualização automática: recarrega sem piscar o carregamento.
  const tokenAnterior = useRef(refreshToken)
  useEffect(() => {
    let ativo = true
    const silencioso = tokenAnterior.current !== refreshToken
    tokenAnterior.current = refreshToken
    if (!silencioso) setLoading(true)
    setError(null)
    const supabase = createClient()

    // Debounce da busca: evita uma RPC a cada tecla digitada.
    const timer = setTimeout(() => {
      Promise.resolve(supabase.rpc('obter_catalogo_produtos', parametros(f)))
        .then(({ data, error }) => {
          if (!ativo) return
          if (error) throw error
          const l = (data as ProdutoCatalogo[]) ?? []
          setLinhas(l)
          setTotalRegistros(l[0]?.total_registros ?? 0)
        })
        .catch((err) => {
          console.error('Erro ao carregar o catálogo de produtos:', err)
          if (ativo) setError('Não foi possível carregar a gestão de produtos.')
        })
        .finally(() => {
          if (ativo) setLoading(false)
        })
    }, 300)

    return () => {
      ativo = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- f é reconstruído a cada render; as dependências abaixo cobrem os campos
  }, [f.filtro, f.busca, f.marca, f.categoria, f.ordenarPor, f.ordenarDirecao, f.pagina, f.tamanhoPagina, refreshToken])

  return { linhas, totalRegistros, loading, error }
}

export function useResumoCatalogo(refreshToken: number) {
  const [resumo, setResumo] = useState<ResumoCatalogo | null>(null)

  useEffect(() => {
    let ativo = true
    const supabase = createClient()
    Promise.resolve(supabase.rpc('obter_resumo_catalogo_produtos', { p_schema_name: TENANT_SCHEMA }))
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) throw error
        const r = (data as ResumoCatalogo[] | null)?.[0]
        if (r) {
          setResumo({
            total: Number(r.total),
            sem_codigo: Number(r.sem_codigo),
            sem_marca: Number(r.sem_marca),
            sem_categoria: Number(r.sem_categoria),
            sem_estoque: Number(r.sem_estoque),
            sem_nuvemshop: Number(r.sem_nuvemshop),
            nuvemshop_despublicado: Number(r.nuvemshop_despublicado),
            preco_alterado: Number(r.preco_alterado),
            sem_custo: Number(r.sem_custo),
          })
        }
      })
      .catch((err) => console.error('Erro ao carregar o resumo do catálogo:', err))
    return () => {
      ativo = false
    }
  }, [refreshToken])

  return resumo
}
