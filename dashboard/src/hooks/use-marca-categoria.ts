'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { tenantSchema } from '@/lib/tenant'

/** 'sem_marca_ou_categoria' = falta uma das duas; 'completos' = tem marca e categoria. */
export type FiltroMarcaCategoria = 'todos' | 'sem_marca' | 'sem_categoria' | 'sem_marca_ou_categoria' | 'completos'
export type OrdenarMarcaCategoriaPor = 'nome' | 'marca'
export type OrdenarDirecao = 'asc' | 'desc'

export interface CategoriaDoProduto {
  id: number
  nome: string
  /** "MÁQUINAS PROFISSIONAIS › MARCAS › WAHL" */
  caminho: string
}

/** Um produto da Nuvemshop (não a variante) com a marca e as categorias que tem hoje. */
export interface ProdutoMarcaCategoria {
  store_id: number
  id_produto_ns: number
  nome: string | null
  publicado: boolean | null
  qtd_variantes: number
  sku_exemplo: string | null
  imagem_url: string | null
  url: string | null
  marca: string | null
  categorias: CategoriaDoProduto[]
  total_registros: number
}

export interface CategoriaNuvemshop {
  store_id: number
  id_categoria: number
  nome: string
  id_pai: number | null
  caminho: string
  nivel: number
  qtd_produtos: number
  qtd_subcategorias: number
}

export interface MarcaNuvemshop {
  nome: string
  qtd_produtos: number
  /** > 1: a mesma marca está escrita de mais de um jeito (ex.: "Wahl" e "WAHL", ou com espaço no fim). */
  grafias_na_chave: number
  criada_no_bi: boolean
}

export interface ResumoMarcaCategoria {
  total: number
  sem_marca: number
  sem_categoria: number
  sem_ambos: number
  completos: number
}

export interface FiltrosMarcaCategoria {
  filtro: FiltroMarcaCategoria
  busca: string
  /** Marca exata (sem diferença de maiúscula/espaço); '' = qualquer. */
  marca: string
  /** Categoria (e suas subcategorias); null = qualquer. */
  categoriaId: number | null
  apenasPublicados: boolean
  ordenarPor: OrdenarMarcaCategoriaPor
  ordenarDirecao: OrdenarDirecao
  pagina: number
  tamanhoPagina: number
}

function parametros(f: FiltrosMarcaCategoria) {
  return {
    p_schema_name: tenantSchema(),
    p_filtro: f.filtro,
    p_busca: f.busca.trim() || null,
    p_marca: f.marca.trim() || null,
    p_categoria_id: f.categoriaId,
    p_apenas_publicados: f.apenasPublicados,
    p_ordenar_por: f.ordenarPor,
    p_ordenar_direcao: f.ordenarDirecao,
    p_pagina: f.pagina,
    p_tamanho_pagina: f.tamanhoPagina,
  }
}

export function useProdutosMarcaCategoria(filtros: FiltrosMarcaCategoria, gatilho: number) {
  const [linhas, setLinhas] = useState<ProdutoMarcaCategoria[]>([])
  const [totalRegistros, setTotalRegistros] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { filtro, busca, marca, categoriaId, apenasPublicados, ordenarPor, ordenarDirecao, pagina, tamanhoPagina } = filtros

  useEffect(() => {
    let ativo = true
    setLoading(true)
    setError(null)
    const supabase = createClient()
    // Debounce da busca: evita disparar uma RPC a cada tecla digitada.
    const timer = setTimeout(() => {
      Promise.resolve(
        supabase.rpc('obter_produtos_marca_categoria', parametros({ filtro, busca, marca, categoriaId, apenasPublicados, ordenarPor, ordenarDirecao, pagina, tamanhoPagina }))
      )
        .then(({ data, error }) => {
          if (!ativo) return
          if (error) throw error
          const lista = (data as ProdutoMarcaCategoria[]) ?? []
          setLinhas(lista)
          setTotalRegistros(Number(lista[0]?.total_registros ?? 0))
        })
        .catch((err) => {
          console.error('Erro ao carregar marca e categoria:', err)
          if (ativo) setError('Não foi possível carregar os produtos.')
        })
        .finally(() => {
          if (ativo) setLoading(false)
        })
    }, 300)
    return () => {
      ativo = false
      clearTimeout(timer)
    }
  }, [filtro, busca, marca, categoriaId, apenasPublicados, ordenarPor, ordenarDirecao, pagina, tamanhoPagina, gatilho])

  return { linhas, totalRegistros, loading, error }
}

/** Todos os produtos do filtro (páginas de 1000 — o limite do Supabase por RPC): seleção em massa e exportação. */
export async function buscarTodosProdutosMarcaCategoria(f: Omit<FiltrosMarcaCategoria, 'pagina' | 'tamanhoPagina'>): Promise<ProdutoMarcaCategoria[]> {
  const supabase = createClient()
  const TAMANHO = 1000
  const todos: ProdutoMarcaCategoria[] = []
  for (let pagina = 1; ; pagina++) {
    const { data, error } = await supabase.rpc('obter_produtos_marca_categoria', parametros({ ...f, pagina, tamanhoPagina: TAMANHO }))
    if (error) throw error
    const lote = (data as ProdutoMarcaCategoria[]) ?? []
    todos.push(...lote)
    if (lote.length < TAMANHO) break
  }
  return todos
}

export function useResumoMarcaCategoria(apenasPublicados: boolean, gatilho: number) {
  const [resumo, setResumo] = useState<ResumoMarcaCategoria | null>(null)
  useEffect(() => {
    let ativo = true
    Promise.resolve(createClient().rpc('obter_resumo_marca_categoria', { p_schema_name: tenantSchema(), p_apenas_publicados: apenasPublicados }))
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) throw error
        const r = (data as ResumoMarcaCategoria[])?.[0]
        setResumo(r ? { total: Number(r.total), sem_marca: Number(r.sem_marca), sem_categoria: Number(r.sem_categoria), sem_ambos: Number(r.sem_ambos), completos: Number(r.completos) } : null)
      })
      .catch((err) => console.error('Erro ao carregar o resumo de marca e categoria:', err))
    return () => {
      ativo = false
    }
  }, [apenasPublicados, gatilho])
  return resumo
}

export function useCategoriasNuvemshop(gatilho: number) {
  const [categorias, setCategorias] = useState<CategoriaNuvemshop[]>([])
  useEffect(() => {
    let ativo = true
    Promise.resolve(createClient().rpc('obter_categorias_nuvemshop', { p_schema_name: tenantSchema() }))
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) throw error
        setCategorias(((data as CategoriaNuvemshop[]) ?? []).map((c) => ({ ...c, id_categoria: Number(c.id_categoria), id_pai: c.id_pai === null ? null : Number(c.id_pai), qtd_produtos: Number(c.qtd_produtos), qtd_subcategorias: Number(c.qtd_subcategorias) })))
      })
      .catch((err) => console.error('Erro ao carregar as categorias:', err))
    return () => {
      ativo = false
    }
  }, [gatilho])
  return categorias
}

export function useMarcasNuvemshop(gatilho: number) {
  const [marcas, setMarcas] = useState<MarcaNuvemshop[]>([])
  useEffect(() => {
    let ativo = true
    Promise.resolve(createClient().rpc('obter_marcas_nuvemshop', { p_schema_name: tenantSchema() }))
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) throw error
        setMarcas(((data as MarcaNuvemshop[]) ?? []).map((m) => ({ ...m, qtd_produtos: Number(m.qtd_produtos), grafias_na_chave: Number(m.grafias_na_chave) })))
      })
      .catch((err) => console.error('Erro ao carregar as marcas:', err))
    return () => {
      ativo = false
    }
  }, [gatilho])
  return marcas
}
