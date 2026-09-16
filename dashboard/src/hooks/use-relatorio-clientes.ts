'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { formatarRangeParaAPI, type RangeData } from '@/lib/date-ranges'

export type OrdenarClientesPor = 'valor_vendido' | 'qtde_pedidos' | 'ticket_medio' | 'ultima_compra' | 'frequencia_media'
export type OrdenarDirecao = 'asc' | 'desc'
export type StatusCliente = 'Novo' | 'Recorrente' | 'Não identificado'

export interface LinhaRelatorioCliente {
  id_contato: number | null
  nome_contato: string | null
  documento_contato: string | null
  tipo_pessoa_contato: string | null
  municipio: string | null
  uf: string | null
  telefone: string | null
  email: string | null
  data_nascimento: string | null
  total_pedidos: number
  unidades_vendidas: number
  faturamento: number
  ticket_medio: number
  ultima_compra: string | null
  frequencia_media_dias: number | null
  status_cliente: StatusCliente
  total_registros: number
}

interface Args {
  atual: RangeData
  canais: number[] | null
  busca: string
  cidade: string | null
  ultimaCompraAntesDe: string | null
  incluirSemVenda: boolean
  frequenciaMinDias: number | null
  frequenciaMaxDias: number | null
  ordenarPor: OrdenarClientesPor
  ordenarDirecao: OrdenarDirecao
  pagina: number
  tamanhoPagina: number
}

export function useRelatorioClientes({
  atual,
  canais,
  busca,
  cidade,
  ultimaCompraAntesDe,
  incluirSemVenda,
  frequenciaMinDias,
  frequenciaMaxDias,
  ordenarPor,
  ordenarDirecao,
  pagina,
  tamanhoPagina,
}: Args) {
  const [linhas, setLinhas] = useState<LinhaRelatorioCliente[]>([])
  const [totalRegistros, setTotalRegistros] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gatilho, setGatilho] = useState(0)

  useEffect(() => {
    let ativo = true
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data_inicial, data_final } = formatarRangeParaAPI(atual)

    // Debounce da busca: evita disparar uma RPC a cada tecla digitada.
    const timer = setTimeout(() => {
      Promise.resolve(
        supabase.rpc('obter_relatorio_vendas_clientes', {
          p_schema_name: TENANT_SCHEMA,
          p_data_inicial: data_inicial,
          p_data_final: data_final,
          p_canais: canais,
          p_busca: busca.trim() || null,
          p_cidade: cidade,
          p_ultima_compra_antes_de: ultimaCompraAntesDe,
          p_incluir_sem_venda: incluirSemVenda,
          p_frequencia_min_dias: frequenciaMinDias,
          p_frequencia_max_dias: frequenciaMaxDias,
          p_ordenar_por: ordenarPor,
          p_ordenar_direcao: ordenarDirecao,
          p_pagina: pagina,
          p_tamanho_pagina: tamanhoPagina,
        })
      )
        .then(({ data, error }) => {
          if (!ativo) return
          if (error) throw error
          const linhas = (data as LinhaRelatorioCliente[]) ?? []
          setLinhas(linhas)
          setTotalRegistros(linhas[0]?.total_registros ?? 0)
        })
        .catch((err) => {
          console.error('Erro ao carregar relatório de vendas por cliente:', err)
          if (ativo) setError('Não foi possível carregar o relatório de vendas por cliente.')
        })
        .finally(() => {
          if (ativo) setLoading(false)
        })
    }, 300)

    return () => {
      ativo = false
      clearTimeout(timer)
    }
  }, [
    atual,
    canais,
    busca,
    cidade,
    ultimaCompraAntesDe,
    incluirSemVenda,
    frequenciaMinDias,
    frequenciaMaxDias,
    ordenarPor,
    ordenarDirecao,
    pagina,
    tamanhoPagina,
    gatilho,
  ])

  return { linhas, totalRegistros, loading, error, recarregar: () => setGatilho((g) => g + 1) }
}
