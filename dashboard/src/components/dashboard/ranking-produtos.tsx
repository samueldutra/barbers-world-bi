'use client'

import Image from 'next/image'
import { Package } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatarMoeda, formatarNumero } from '@/lib/formatters'
import type { OrdenarRankingPor, ProdutoRanking } from '@/hooks/use-ranking-produtos'

interface Props {
  produtos: ProdutoRanking[]
  ordenarPor: OrdenarRankingPor
  onOrdenarPorChange: (v: OrdenarRankingPor) => void
}

export function RankingProdutos({ produtos, ordenarPor, onOrdenarPorChange }: Props) {
  const totalFaturamento = produtos.reduce((acc, p) => acc + Number(p.faturamento || 0), 0)

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Produtos mais vendidos</CardTitle>
          <CardDescription>Top 10 no período</CardDescription>
        </div>
        <ToggleGroup
          type="single"
          value={ordenarPor}
          onValueChange={(v) => v && onOrdenarPorChange(v as OrdenarRankingPor)}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="faturamento">Faturamento</ToggleGroupItem>
          <ToggleGroupItem value="unidades">Unidades</ToggleGroupItem>
          <ToggleGroupItem value="pedidos">Pedidos</ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>
      <CardContent>
        {produtos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma venda encontrada para este período.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {produtos.map((produto, index) => {
              const participacao = totalFaturamento > 0 ? (Number(produto.faturamento) / totalFaturamento) * 100 : 0
              return (
                <li key={`${produto.id_produto ?? produto.codigo ?? 'produto'}-${index}`} className="flex items-center gap-3 py-3">
                  <span className="w-5 shrink-0 text-sm font-medium text-muted-foreground">{index + 1}</span>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {produto.imagem_url ? (
                      <Image src={produto.imagem_url} alt={produto.nome || ''} width={40} height={40} className="h-full w-full object-cover" unoptimized />
                    ) : (
                      <Package className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{produto.nome || 'Produto sem nome'}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[produto.codigo, produto.marca, produto.categoria_descricao].filter(Boolean).join(' · ') || 'Sem SKU/marca/categoria'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums">{formatarMoeda(Number(produto.faturamento))}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatarNumero(Number(produto.unidades_vendidas))} un · {participacao.toFixed(1)}%
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
