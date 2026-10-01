'use client'

import { RankingBarChart } from '@/components/dashboard/ranking-bar-chart'
import type { VendaPorCanal } from '@/hooks/use-vendas-dashboard'
import { logoDoCanal } from '@/lib/canais'

interface Props {
  dados: VendaPorCanal[]
  onSelecionarCanal?: (idLoja: number) => void
}

export function VendasPorCanalChart({ dados, onSelecionarCanal }: Props) {
  const dadosComLabel = dados.map((d) => ({ ...d, canal: d.canal_descricao || 'Sem canal', faturamento: Number(d.faturamento || 0) }))

  return (
    <RankingBarChart
      titulo="Vendas por canal"
      descricao="Participação de cada canal no faturamento do período"
      dados={dadosComLabel}
      chaveLabel="canal"
      iconeDoItem={(item) => logoDoCanal(item.canal_grupo)}
      mostrarValorEPercentual
      onSelecionar={onSelecionarCanal ? (item) => onSelecionarCanal(item.id_loja) : undefined}
    />
  )
}
