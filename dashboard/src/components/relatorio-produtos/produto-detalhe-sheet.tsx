'use client'

import { ProdutoImagem } from '@/components/produto-imagem'
import { ComparacaoPrecos } from '@/components/relatorio-produtos/comparacao-precos'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useComparacaoPrecos } from '@/hooks/use-comparacao-precos'
import type { LinhaRelatorioProduto } from '@/hooks/use-relatorio-produtos'
import { formatarMoeda, formatarNumero } from '@/lib/formatters'

interface Props {
  /** Produto aberto na listagem (null = fechado). */
  linha: LinhaRelatorioProduto | null
  onFechar: () => void
}

/** Painel do produto aberto na listagem de Produtos. Ao abrir, já busca os preços da concorrência. */
export function ProdutoDetalheSheet({ linha, onFechar }: Props) {
  const idProduto = linha?.id_produto ?? null
  const comparacao = useComparacaoPrecos(idProduto)

  return (
    <Sheet open={!!linha} onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="flex-row items-center gap-3 border-b pr-12">
          <ProdutoImagem src={linha?.imagem_url} alt={linha?.nome ?? ''} tamanho={56} />
          <div className="min-w-0">
            <SheetTitle className="line-clamp-2 text-base leading-snug">{linha?.nome || 'Produto'}</SheetTitle>
            <SheetDescription className="truncate">
              {[linha?.codigo, linha?.marca].filter(Boolean).join(' · ') || 'Sem SKU'}
            </SheetDescription>
          </div>
        </SheetHeader>

        <Tabs defaultValue="comparar" className="gap-4 p-4">
          <TabsList>
            <TabsTrigger value="comparar">Comparar preços</TabsTrigger>
            <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
          </TabsList>

          <TabsContent value="comparar">
            <ComparacaoPrecos
              dados={comparacao.dados}
              loading={comparacao.loading}
              erro={comparacao.erro}
              onBuscar={comparacao.buscar}
            />
          </TabsContent>

          <TabsContent value="detalhes">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Categoria', linha?.categoria_descricao || 'Sem categoria'],
                ['Marca', linha?.marca || 'Sem marca'],
                ['Unidades vendidas (período)', formatarNumero(Number(linha?.unidades_vendidas ?? 0))],
                ['Valor vendido (período)', formatarMoeda(Number(linha?.faturamento ?? 0))],
                ['Pedidos (período)', formatarNumero(Number(linha?.pedidos ?? 0))],
              ].map(([rotulo, valor]) => (
                <div key={rotulo} className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">{rotulo}</dt>
                  <dd className="mt-0.5 font-medium">{valor}</dd>
                </div>
              ))}
            </dl>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
