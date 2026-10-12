'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'

/** 'todos' = todas as variantes da Nuvemshop; 'problemas' = todas menos as vinculadas; ou um StatusVinculo. */
export type FiltroStatusVinculo = 'todos' | 'problemas' | string
export type OrdenarVinculoPor = 'status' | 'nome' | 'sku'
export type OrdenarDirecao = 'asc' | 'desc'

export interface LinhaVinculo {
  visao: 'nuvemshop' | 'bling'
  store_id: number | null
  id_produto_ns: number | null
  id_variante: number | null
  nome_ns: string | null
  variacao_ns: string | null
  sku_ns: string | null
  publicado: boolean | null
  preco_ns: number | null
  preco_promocional_ns: number | null
  estoque_ns: number | null
  url_ns: string | null
  imagem_url: string | null
  id_produto_bling: number | null
  codigo_bling: string | null
  nome_bling: string | null
  preco_bling: number | null
  formato_bling: string | null
  qtd_bling: number
  status: string
  /** Produto "só no Bling" de nome mais parecido (só em sem_correspondencia/sem_sku); null = sem sugestão. */
  sugestao_id_produto_bling: number | null
  sugestao_codigo: string | null
  sugestao_nome: string | null
  sugestao_preco: number | null
  /** 0 a 1; 1 = nome idêntico depois de normalizar. */
  sugestao_score: number | null
  total_registros: number
}

export interface FiltrosVinculo {
  status: FiltroStatusVinculo
  busca: string
  apenasPublicados: boolean
  /** Só variantes com estoque > 0 na Nuvemshop (estoque não controlado fica de fora). */
  apenasComEstoque: boolean
  ordenarPor: OrdenarVinculoPor
  ordenarDirecao: OrdenarDirecao
  pagina: number
  tamanhoPagina: number
}

export function parametrosVinculo(f: FiltrosVinculo) {
  return {
    p_schema_name: TENANT_SCHEMA,
    p_status: f.status,
    p_busca: f.busca.trim() || null,
    p_apenas_publicados: f.apenasPublicados,
    p_apenas_com_estoque: f.apenasComEstoque,
    p_ordenar_por: f.ordenarPor,
    p_ordenar_direcao: f.ordenarDirecao,
    p_pagina: f.pagina,
    p_tamanho_pagina: f.tamanhoPagina,
  }
}

export function useVinculoSku(filtros: FiltrosVinculo) {
  const [linhas, setLinhas] = useState<LinhaVinculo[]>([])
  const [totalRegistros, setTotalRegistros] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gatilho, setGatilho] = useState(0)

  const { status, busca, apenasPublicados, apenasComEstoque, ordenarPor, ordenarDirecao, pagina, tamanhoPagina } = filtros

  useEffect(() => {
    let ativo = true
    setLoading(true)
    setError(null)
    const supabase = createClient()

    // Debounce da busca: evita disparar uma RPC a cada tecla digitada.
    const timer = setTimeout(() => {
      Promise.resolve(
        supabase.rpc(
          'obter_vinculo_sku_nuvemshop',
          parametrosVinculo({ status, busca, apenasPublicados, apenasComEstoque, ordenarPor, ordenarDirecao, pagina, tamanhoPagina })
        )
      )
        .then(({ data, error }) => {
          if (!ativo) return
          if (error) throw error
          const linhas = (data as LinhaVinculo[]) ?? []
          setLinhas(linhas)
          setTotalRegistros(linhas[0]?.total_registros ?? 0)
        })
        .catch((err) => {
          console.error('Erro ao carregar o vínculo de SKU:', err)
          if (ativo) setError('Não foi possível carregar o vínculo de SKU.')
        })
        .finally(() => {
          if (ativo) setLoading(false)
        })
    }, 300)

    return () => {
      ativo = false
      clearTimeout(timer)
    }
  }, [status, busca, apenasPublicados, apenasComEstoque, ordenarPor, ordenarDirecao, pagina, tamanhoPagina, gatilho])

  return { linhas, totalRegistros, loading, error, recarregar: () => setGatilho((g) => g + 1) }
}

/** Contagem por status (cartões do topo). */
export function useResumoVinculoSku(apenasPublicados: boolean, apenasComEstoque: boolean, gatilho: number) {
  const [resumo, setResumo] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ativo = true
    setLoading(true)
    const supabase = createClient()
    Promise.resolve(
      supabase.rpc('obter_resumo_vinculo_sku_nuvemshop', {
        p_schema_name: TENANT_SCHEMA,
        p_apenas_publicados: apenasPublicados,
        p_apenas_com_estoque: apenasComEstoque,
      })
    )
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) throw error
        const mapa: Record<string, number> = {}
        for (const r of (data as { status: string; quantidade: number }[]) ?? []) mapa[r.status] = Number(r.quantidade)
        setResumo(mapa)
      })
      .catch((err) => console.error('Erro ao carregar o resumo do vínculo de SKU:', err))
      .finally(() => {
        if (ativo) setLoading(false)
      })
    return () => {
      ativo = false
    }
  }, [apenasPublicados, apenasComEstoque, gatilho])

  return { resumo, loading }
}

/** Busca todas as linhas do filtro (páginas de 1000 — o limite do Supabase por RPC) pra exportar em CSV. */
export async function buscarTodasLinhasVinculo(f: Omit<FiltrosVinculo, 'pagina' | 'tamanhoPagina'>): Promise<LinhaVinculo[]> {
  const supabase = createClient()
  const TAMANHO = 1000
  const todas: LinhaVinculo[] = []
  for (let pagina = 1; ; pagina++) {
    const { data, error } = await supabase.rpc('obter_vinculo_sku_nuvemshop', parametrosVinculo({ ...f, pagina, tamanhoPagina: TAMANHO }))
    if (error) throw error
    const lote = (data as LinhaVinculo[]) ?? []
    todas.push(...lote)
    if (lote.length < TAMANHO) break
  }
  return todas
}

/** Par Bling × Nuvemshop confirmado por ID a partir dos pedidos (o produto do Bling mais frequente nas vendas da variante). */
export interface ParConfirmado {
  id_variante: number
  id_produto_bling: number
  codigo: string
  nome: string
  preco: number | null
  /** Produto ativo no cadastro do Bling. */
  ativo: boolean
  /** Pedidos distintos que sustentam o par. */
  pedidos: number
  pedidos_unicos: number
  /** > 1: a variante também apareceu em pedidos com outros produtos do Bling. */
  produtos_distintos: number
  /** Empate no topo: não dá pra apontar um produto só. */
  ambiguo: boolean
  /** Quantas OUTRAS variantes da Nuvemshop já usam o código deste produto. */
  qtd_variantes_ns: number
}

/** O par pode ser usado direto: ativo, sem empate e sem outra variante usando o código (senão o servidor recusa). */
export function parUtilizavel(par: ParConfirmado | undefined): par is ParConfirmado {
  return !!par && par.ativo && !par.ambiguo && par.qtd_variantes_ns === 0 && par.codigo.trim() !== ''
}

/** Pares confirmados das variantes informadas (ou de todas, sem argumento). */
export async function buscarParesConfirmados(variantes?: number[]): Promise<ParConfirmado[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('obter_pares_confirmados_nuvemshop', {
    p_schema_name: TENANT_SCHEMA,
    p_variantes: variantes ?? null,
  })
  if (error) throw error
  return (data as ParConfirmado[]) ?? []
}

/** Pares confirmados das variantes da página atual (mapa por id_variante). */
export function useParesConfirmados(linhas: LinhaVinculo[], gatilho: number) {
  const [pares, setPares] = useState<Map<number, ParConfirmado>>(new Map())
  const ids = linhas.filter((l) => l.visao === 'nuvemshop' && l.id_variante !== null).map((l) => l.id_variante as number)
  const chave = ids.join(',')

  useEffect(() => {
    if (ids.length === 0) {
      setPares(new Map())
      return
    }
    let ativo = true
    buscarParesConfirmados(ids)
      .then((lista) => {
        if (ativo) setPares(new Map(lista.map((p) => [p.id_variante, p])))
      })
      .catch((err) => console.error('Erro ao carregar os pares confirmados por pedidos:', err))
    return () => {
      ativo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, gatilho])

  return pares
}

export interface DivergenciaSkuPedidos {
  store_id: number
  id_produto_ns: number
  id_variante: number
  nome_ns: string | null
  variacao_ns: string | null
  sku_ns: string | null
  publicado: boolean | null
  estoque_ns: number | null
  sku_id_produto_bling: number
  sku_codigo: string | null
  sku_nome: string | null
  vendas_id_produto_bling: number
  vendas_codigo: string | null
  vendas_nome: string | null
  vendas_ativo: boolean
  pedidos: number
  produtos_distintos: number
  qtd_variantes_ns: number
}

/** Variantes já vinculadas por SKU cujo produto do Bling pelo SKU difere do produto que as vendas mostram. */
export async function buscarDivergenciasSkuPedidos(): Promise<DivergenciaSkuPedidos[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('obter_divergencias_sku_pedidos', { p_schema_name: TENANT_SCHEMA })
  if (error) throw error
  return (data as DivergenciaSkuPedidos[]) ?? []
}
