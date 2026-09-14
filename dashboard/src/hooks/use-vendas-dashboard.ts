'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { formatarRangeParaAPI, type RangeData } from '@/lib/date-ranges'

export interface KpisVendas {
  faturamento_bruto: number
  total_pedidos: number
  total_itens: number
  ticket_medio: number
  itens_por_pedido: number
  desconto_total: number
  valor_cancelado: number
  pedidos_cancelados: number
}

const KPIS_VAZIO: KpisVendas = {
  faturamento_bruto: 0,
  total_pedidos: 0,
  total_itens: 0,
  ticket_medio: 0,
  itens_por_pedido: 0,
  desconto_total: 0,
  valor_cancelado: 0,
  pedidos_cancelados: 0,
}

export interface EvolucaoPonto {
  dia: string
  faturamento: number
  pedidos: number
  itens: number
  ticket_medio: number
}

export interface EvolucaoComparada {
  diaRelativo: number
  dataAtual: string | null
  dataComparacao: string | null
  faturamentoAtual: number | null
  faturamentoComparacao: number | null
}

export interface VendaPorCanal {
  id_loja: number
  canal_descricao: string | null
  canal_grupo: string | null
  total_pedidos: number
  total_itens: number
  faturamento: number
}

interface UseVendasDashboardArgs {
  atual: RangeData
  comparacao: RangeData | null
  canais: number[] | null
}

export function useVendasDashboard({ atual, comparacao, canais }: UseVendasDashboardArgs) {
  const [kpisAtual, setKpisAtual] = useState<KpisVendas>(KPIS_VAZIO)
  const [kpisComparacao, setKpisComparacao] = useState<KpisVendas>(KPIS_VAZIO)
  const [evolucao, setEvolucao] = useState<EvolucaoComparada[]>([])
  const [porCanal, setPorCanal] = useState<VendaPorCanal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()

    try {
      const { data_inicial, data_final } = formatarRangeParaAPI(atual)
      const comp = comparacao ? formatarRangeParaAPI(comparacao) : null

      const [kpiAtualRes, kpiCompRes, evolAtualRes, evolCompRes, canalRes] = await Promise.all([
        supabase.rpc('obter_kpis_vendas', {
          p_schema_name: TENANT_SCHEMA,
          p_data_inicial: data_inicial,
          p_data_final: data_final,
          p_canais: canais,
        }),
        comp
          ? supabase.rpc('obter_kpis_vendas', {
              p_schema_name: TENANT_SCHEMA,
              p_data_inicial: comp.data_inicial,
              p_data_final: comp.data_final,
              p_canais: canais,
            })
          : Promise.resolve({ data: [KPIS_VAZIO], error: null }),
        supabase.rpc('obter_evolucao_vendas', {
          p_schema_name: TENANT_SCHEMA,
          p_data_inicial: data_inicial,
          p_data_final: data_final,
          p_canais: canais,
        }),
        comp
          ? supabase.rpc('obter_evolucao_vendas', {
              p_schema_name: TENANT_SCHEMA,
              p_data_inicial: comp.data_inicial,
              p_data_final: comp.data_final,
              p_canais: canais,
            })
          : Promise.resolve({ data: [], error: null }),
        supabase.rpc('obter_vendas_por_canal', {
          p_schema_name: TENANT_SCHEMA,
          p_data_inicial: data_inicial,
          p_data_final: data_final,
        }),
      ])

      if (kpiAtualRes.error) throw kpiAtualRes.error
      if (kpiCompRes.error) throw kpiCompRes.error
      if (evolAtualRes.error) throw evolAtualRes.error
      if (evolCompRes.error) throw evolCompRes.error
      if (canalRes.error) throw canalRes.error

      setKpisAtual((kpiAtualRes.data?.[0] as KpisVendas) ?? KPIS_VAZIO)
      setKpisComparacao((kpiCompRes.data?.[0] as KpisVendas) ?? KPIS_VAZIO)
      setPorCanal((canalRes.data as VendaPorCanal[]) ?? [])

      const pontosAtual = (evolAtualRes.data as EvolucaoPonto[]) ?? []
      const pontosComp = (evolCompRes.data as EvolucaoPonto[]) ?? []
      const totalDias = Math.round((atual.fim.getTime() - atual.inicio.getTime()) / 86_400_000) + 1

      const porDiaAtual = new Map(pontosAtual.map((p) => [p.dia, p]))
      const porDiaComp = new Map(pontosComp.map((p) => [p.dia, p]))

      const merged: EvolucaoComparada[] = []
      for (let i = 0; i < totalDias; i++) {
        const dAtual = new Date(atual.inicio)
        dAtual.setDate(dAtual.getDate() + i)
        const dAtualISO = dAtual.toISOString().slice(0, 10)
        const pontoAtual = porDiaAtual.get(dAtualISO)

        let dCompISO: string | null = null
        let pontoComp: EvolucaoPonto | undefined
        if (comparacao) {
          const dComp = new Date(comparacao.inicio)
          dComp.setDate(dComp.getDate() + i)
          dCompISO = dComp.toISOString().slice(0, 10)
          pontoComp = porDiaComp.get(dCompISO)
        }

        merged.push({
          diaRelativo: i + 1,
          dataAtual: dAtualISO,
          dataComparacao: dCompISO,
          faturamentoAtual: pontoAtual?.faturamento ?? 0,
          faturamentoComparacao: comparacao ? pontoComp?.faturamento ?? 0 : null,
        })
      }
      setEvolucao(merged)
      setAtualizadoEm(new Date())
    } catch (err) {
      console.error('Erro ao carregar dashboard de vendas:', err)
      setError('Não foi possível carregar os dados. Tente atualizar novamente.')
    } finally {
      setLoading(false)
    }
  }, [atual, comparacao, canais])

  useEffect(() => {
    carregar()
  }, [carregar])

  return { kpisAtual, kpisComparacao, evolucao, porCanal, loading, error, atualizadoEm, recarregar: carregar }
}
