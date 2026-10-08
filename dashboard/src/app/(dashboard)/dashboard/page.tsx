'use client'

import { useEffect, useMemo, useState } from 'react'
import { IconDeviceTv, IconX } from '@tabler/icons-react'
import { LayoutDashboard } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CanalLogo } from '@/components/filtros/canal-logo'
import { ABAS_DASHBOARD, type AbaDashboard } from '@/lib/abas-canais'
import { Button } from '@/components/ui/button'
import { useTvMode } from '@/contexts/tv-mode-context'
import { Skeleton } from '@/components/ui/skeleton'
import { KpiCard } from '@/components/dashboard/kpi-card'
import { EvolucaoVendasChart } from '@/components/dashboard/evolucao-vendas-chart'
import { VendasPorCanalChart } from '@/components/dashboard/vendas-por-canal-chart'
import { FiltroPeriodo } from '@/components/dashboard/vendas-filtros'
import { FiltrosDrawer } from '@/components/dashboard/filtros-drawer'
import { RankingProdutos } from '@/components/dashboard/ranking-produtos'
import { RankingBarChart } from '@/components/dashboard/ranking-bar-chart'
import { useVendasDashboard } from '@/hooks/use-vendas-dashboard'
import { useCanaisVenda } from '@/hooks/use-canais-venda'
import { useSituacoesPedido } from '@/hooks/use-situacoes-pedido'
import { descreverSelecaoSituacoes } from '@/components/filtros/filtro-situacoes'
import { useRankingProdutos, type OrdenarRankingPor } from '@/hooks/use-ranking-produtos'
import { obterRangePreset, obterRangeComparacao, rangePadrao, type PeriodoPreset, type RangeData } from '@/lib/date-ranges'
import { formatarMoeda, formatarNumero } from '@/lib/formatters'

/** Atualização automática dos dados (sem botão de atualizar): a cada 10 minutos. */
const INTERVALO_ATUALIZACAO_MS = 10 * 60 * 1000

export default function DashboardPage() {
  const { tvMode, entrar: entrarModoTv, sair: sairModoTv } = useTvMode()
  // Muda a cada atualização automática: recalcula os períodos ("hoje", "mês atual"...) e
  // recarrega os dados sem piscar o esqueleto.
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setRefreshToken((t) => t + 1), INTERVALO_ATUALIZACAO_MS)
    return () => clearInterval(id)
  }, [])

  // O modo TV é só do Dashboard: sai (tela cheia, menu escondido) ao navegar pra outra página.
  useEffect(() => sairModoTv, [sairModoTv])

  const [periodo, setPeriodo] = useState<PeriodoPreset>('mes_atual')
  const [rangePersonalizado, setRangePersonalizado] = useState<RangeData | null>(null)
  const [aba, setAba] = useState<AbaDashboard>('geral')
  // Escolha do usuário no filtro de canais — só vale na aba Geral e é preservada ao navegar entre abas.
  const [canaisSelecionados, setCanaisSelecionados] = useState<number[] | null>(null)
  // null = filtro padrão de situações do dashboard (situacoes_padrao_dashboard() no banco).
  const [situacoesSelecionadas, setSituacoesSelecionadas] = useState<number[] | null>(null)
  const [ordenarRankingPor, setOrdenarRankingPor] = useState<OrdenarRankingPor>('faturamento')

  const { atual, comparacao } = useMemo(() => {
    if (periodo === 'mes_atual') return rangePadrao()
    const range = periodo === 'personalizado' ? (rangePersonalizado ?? obterRangePreset(periodo)) : obterRangePreset(periodo)
    const comp = obterRangeComparacao(range, 'periodo_anterior')
    return { atual: range, comparacao: comp }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshToken força recalcular datas relativas (hoje, mês atual) na atualização automática do modo TV
  }, [periodo, rangePersonalizado, refreshToken])

  const { canais, loading: carregandoCanais } = useCanaisVenda()

  // Aba de canal: usa o período e a situação escolhidos, mas IGNORA o filtro de canais — os
  // canais são todos os do grupo da aba (inclui lojas antigas/recriadas do mesmo marketplace).
  const abaDeCanal = ABAS_DASHBOARD.find((a) => a.id === aba && a.grupo) ?? null
  const canaisDaAba = useMemo(
    () => (abaDeCanal ? canais.filter((c) => c.grupo === abaDeCanal.grupo).map((c) => c.id_loja) : null),
    [abaDeCanal, canais]
  )
  const canaisEfetivos = abaDeCanal ? canaisDaAba : canaisSelecionados
  const { situacoes } = useSituacoesPedido({ atual, canais: canaisEfetivos, refreshToken })
  const { kpisAtual, kpisComparacao, evolucao, porCanal, loading, error, atualizadoEm } = useVendasDashboard({
    atual,
    comparacao,
    canais: canaisEfetivos,
    situacoes: situacoesSelecionadas,
    refreshToken,
  })
  // Filtro de canais lista só canais com venda > 0 no período (mesma regra de situações do
  // obter_vendas_por_canal, que ignora o filtro de canal — então a lista não encolhe ao
  // selecionar um). Canais já selecionados continuam visíveis mesmo zerados, senão não daria
  // pra ver/desmarcar um canal que está zerando o dashboard inteiro.
  const canaisComVenda = useMemo(() => {
    const comVenda = new Set(porCanal.filter((c) => Number(c.faturamento) > 0).map((c) => c.id_loja))
    return canais.filter((c) => comVenda.has(c.id_loja) || canaisSelecionados?.includes(c.id_loja))
  }, [canais, porCanal, canaisSelecionados])
  const { ranking, porCategoria, porMarca } = useRankingProdutos({
    atual,
    canais: canaisEfetivos,
    situacoes: situacoesSelecionadas,
    ordenarPor: ordenarRankingPor,
    refreshToken,
  })

  const comComparacao = comparacao !== null

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Visão geral</h1>
          <p className="text-sm text-muted-foreground">
            {abaDeCanal ? `Vendas do canal ${abaDeCanal.label} (todas as lojas do canal)` : 'Vendas consolidadas de todos os canais da Barbers World'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FiltroPeriodo
            periodo={periodo}
            onPeriodoChange={setPeriodo}
            rangePersonalizado={rangePersonalizado}
            onRangePersonalizadoChange={setRangePersonalizado}
          />
          <FiltrosDrawer
            canais={canaisComVenda}
            canaisSelecionados={canaisSelecionados}
            onCanaisChange={setCanaisSelecionados}
            situacoes={situacoes}
            situacoesSelecionadas={situacoesSelecionadas}
            onSituacoesChange={setSituacoesSelecionadas}
            abaDeCanal={abaDeCanal}
          />
          <Button
            variant={tvMode ? 'default' : 'outline'}
            size="sm"
            onClick={tvMode ? sairModoTv : entrarModoTv}
            aria-pressed={tvMode}
          >
            {tvMode ? <IconX className="size-4" /> : <IconDeviceTv className="size-4" />}
            {tvMode ? 'Sair do modo TV' : 'Modo TV'}
          </Button>
        </div>
      </div>

      <Tabs value={aba} onValueChange={(v) => setAba(v as AbaDashboard)} className="-mb-2">
        <div className="max-w-full overflow-x-auto">
          <TabsList>
            {ABAS_DASHBOARD.map((a) => (
              <TabsTrigger key={a.id} value={a.id} disabled={!!a.grupo && carregandoCanais}>
                {a.grupo ? <CanalLogo grupo={a.grupo} tamanho={16} /> : <LayoutDashboard className="size-4" />}
                {a.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {atualizadoEm && (
        <p className="-mt-4 text-xs text-muted-foreground">
          Dados atualizados às {atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          {' · '}Situações consideradas: {descreverSelecaoSituacoes(situacoes, situacoesSelecionadas)}
          {' · '}Atualização automática a cada 10 min
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
              tooltip="Valor total dos pedidos nas situações selecionadas no filtro (padrão: só pedidos Atendidos), antes de descontos e taxas."
              valorFormatado={formatarMoeda(kpisAtual.faturamento_bruto)}
              atual={kpisAtual.faturamento_bruto}
              anterior={kpisComparacao.faturamento_bruto}
              anteriorFormatado={formatarMoeda(kpisComparacao.faturamento_bruto)}
              comComparacao={comComparacao}
            />
            <KpiCard
              titulo="Pedidos"
              tooltip="Número de pedidos no período nas situações selecionadas no filtro (padrão: só pedidos Atendidos)."
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
              tooltip="Soma dos descontos em valor (R$) aplicados nos pedidos das situações selecionadas no filtro."
              valorFormatado={formatarMoeda(kpisAtual.desconto_total)}
              atual={kpisAtual.desconto_total}
              anterior={kpisComparacao.desconto_total}
              anteriorFormatado={formatarMoeda(kpisComparacao.desconto_total)}
              comComparacao={comComparacao}
            />
            <KpiCard
              titulo="Cancelamentos"
              tooltip="Valor e quantidade de pedidos marcados como Cancelado ou Devolução no Bling. Não depende do filtro de situações."
              valorFormatado={formatarMoeda(kpisAtual.valor_cancelado)}
              atual={kpisAtual.valor_cancelado}
              anterior={kpisComparacao.valor_cancelado}
              anteriorFormatado={formatarMoeda(kpisComparacao.valor_cancelado)}
              comComparacao={comComparacao}
            />
          </div>

          <EvolucaoVendasChart dados={evolucao} comComparacao={comComparacao} />

          <VendasPorCanalChart
            dados={canaisDaAba ? porCanal.filter((c) => canaisDaAba.includes(c.id_loja)) : porCanal}
            onSelecionarCanal={abaDeCanal ? undefined : (idLoja) => setCanaisSelecionados([idLoja])}
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
