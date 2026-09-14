'use client'

import { useMemo, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { EvolucaoVendasChart } from '@/components/dashboard/evolucao-vendas-chart'
import { VendasPorCanalChart } from '@/components/dashboard/vendas-por-canal-chart'
import { VendasFiltros } from '@/components/dashboard/vendas-filtros'
import { RankingProdutos } from '@/components/dashboard/ranking-produtos'
import { RankingBarChart } from '@/components/dashboard/ranking-bar-chart'
import { useVendasDashboard } from '@/hooks/use-vendas-dashboard'
import { useCanaisVenda } from '@/hooks/use-canais-venda'
import { useRankingProdutos, type OrdenarRankingPor } from '@/hooks/use-ranking-produtos'
import { obterRangePreset, obterRangeComparacao, rangePadrao, type PeriodoPreset, type RangeData } from '@/lib/date-ranges'
import { formatarMoeda, formatarNumero } from '@/lib/formatters'

export default function DashboardPage() {
  const [periodo, setPeriodo] = useState<PeriodoPreset>('mes_atual')
  const [rangePersonalizado, setRangePersonalizado] = useState<RangeData | null>(null)
  const [canaisSelecionados, setCanaisSelecionados] = useState<number[] | null>(null)
  const [ordenarRankingPor, setOrdenarRankingPor] = useState<OrdenarRankingPor>('faturamento')

  const { atual, comparacao } = useMemo(() => {
    if (periodo === 'mes_atual') return rangePadrao()
    const range = periodo === 'personalizado' ? (rangePersonalizado ?? obterRangePreset(periodo)) : obterRangePreset(periodo)
    const comp = obterRangeComparacao(range, 'periodo_anterior')
    return { atual: range, comparacao: comp }
  }, [periodo, rangePersonalizado])

  const { canais } = useCanaisVenda()
  const { kpisAtual, kpisComparacao, evolucao, porCanal, loading, error, atualizadoEm, recarregar } = useVendasDashboard({
    atual,
    comparacao,
    canais: canaisSelecionados,
  })
  const { ranking, porCategoria, porMarca } = useRankingProdutos({
    atual,
    canais: canaisSelecionados,
    ordenarPor: ordenarRankingPor,
  })

  const comComparacao = comparacao !== null

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Visão geral</h1>
          <p className="text-sm text-muted-foreground">Vendas consolidadas de todos os canais da Barbers World</p>
        </div>
        <VendasFiltros
          periodo={periodo}
          onPeriodoChange={setPeriodo}
          rangePersonalizado={rangePersonalizado}
          onRangePersonalizadoChange={setRangePersonalizado}
          canais={canais}
          canaisSelecionados={canaisSelecionados}
          onCanaisChange={setCanaisSelecionados}
          onAtualizar={recarregar}
          atualizando={loading}
        />
      </div>

      {atualizadoEm && (
        <p className="-mt-4 text-xs text-muted-foreground">
          Dados atualizados às {atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              titulo="Faturamento bruto"
              tooltip="Valor total das vendas realizadas antes de descontos, taxas e cancelamentos."
              valorFormatado={formatarMoeda(kpisAtual.faturamento_bruto)}
              atual={kpisAtual.faturamento_bruto}
              anterior={kpisComparacao.faturamento_bruto}
              anteriorFormatado={formatarMoeda(kpisComparacao.faturamento_bruto)}
              comComparacao={comComparacao}
            />
            <KpiCard
              titulo="Pedidos"
              tooltip="Número de pedidos válidos no período (exclui cancelados e devoluções)."
              valorFormatado={formatarNumero(kpisAtual.total_pedidos)}
              atual={kpisAtual.total_pedidos}
              anterior={kpisComparacao.total_pedidos}
              anteriorFormatado={formatarNumero(kpisComparacao.total_pedidos)}
              comComparacao={comComparacao}
            />
            <KpiCard
              titulo="Ticket médio"
              tooltip="Faturamento bruto dividido pelo número de pedidos."
              valorFormatado={formatarMoeda(kpisAtual.ticket_medio)}
              atual={kpisAtual.ticket_medio}
              anterior={kpisComparacao.ticket_medio}
              anteriorFormatado={formatarMoeda(kpisComparacao.ticket_medio)}
              comComparacao={comComparacao}
            />
            <KpiCard
              titulo="Produtos vendidos"
              tooltip="Quantidade total de unidades vendidas (um pedido pode ter vários produtos)."
              valorFormatado={formatarNumero(kpisAtual.total_itens)}
              atual={kpisAtual.total_itens}
              anterior={kpisComparacao.total_itens}
              anteriorFormatado={formatarNumero(kpisComparacao.total_itens)}
              comComparacao={comComparacao}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              titulo="Faturamento líquido (aprox.)"
              tooltip="Faturamento bruto menos descontos concedidos. Ainda não considera taxas de marketplace, frete ou devoluções parciais — regra completa entra em uma fase futura."
              valorFormatado={formatarMoeda(kpisAtual.faturamento_bruto - kpisAtual.desconto_total)}
              atual={kpisAtual.faturamento_bruto - kpisAtual.desconto_total}
              anterior={kpisComparacao.faturamento_bruto - kpisComparacao.desconto_total}
              anteriorFormatado={formatarMoeda(kpisComparacao.faturamento_bruto - kpisComparacao.desconto_total)}
              comComparacao={comComparacao}
            />
            <KpiCard
              titulo="Itens por pedido"
              tooltip="Quantidade de produtos vendidos dividida pelo número de pedidos."
              valorFormatado={kpisAtual.itens_por_pedido.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
              atual={kpisAtual.itens_por_pedido}
              anterior={kpisComparacao.itens_por_pedido}
              anteriorFormatado={kpisComparacao.itens_por_pedido.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
              comComparacao={comComparacao}
            />
            <KpiCard
              titulo="Descontos concedidos"
              tooltip="Soma dos descontos em valor (R$) aplicados nos pedidos válidos do período."
              valorFormatado={formatarMoeda(kpisAtual.desconto_total)}
              atual={kpisAtual.desconto_total}
              anterior={kpisComparacao.desconto_total}
              anteriorFormatado={formatarMoeda(kpisComparacao.desconto_total)}
              comComparacao={comComparacao}
            />
            <KpiCard
              titulo="Cancelamentos"
              tooltip="Valor e quantidade de pedidos marcados como Cancelado ou Devolução no Bling."
              valorFormatado={formatarMoeda(kpisAtual.valor_cancelado)}
              atual={kpisAtual.valor_cancelado}
              anterior={kpisComparacao.valor_cancelado}
              anteriorFormatado={formatarMoeda(kpisComparacao.valor_cancelado)}
              comComparacao={comComparacao}
            />
          </div>

          <EvolucaoVendasChart dados={evolucao} comComparacao={comComparacao} />

          <VendasPorCanalChart
            dados={porCanal}
            onSelecionarCanal={(idLoja) => setCanaisSelecionados([idLoja])}
          />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RankingProdutos produtos={ranking} ordenarPor={ordenarRankingPor} onOrdenarPorChange={setOrdenarRankingPor} />
            <div className="flex flex-col gap-4">
              <RankingBarChart
                titulo="Vendas por categoria"
                descricao="Participação de cada categoria no faturamento do período"
                dados={porCategoria}
                chaveLabel="categoria_descricao"
              />
              <RankingBarChart
                titulo="Vendas por marca"
                descricao="Participação de cada marca no faturamento do período"
                dados={porMarca}
                chaveLabel="marca"
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
