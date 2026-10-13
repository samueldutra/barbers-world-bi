'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { buscarDivergenciasSkuPedidos, type DivergenciaSkuPedidos } from '@/hooks/use-vinculo-sku'

interface Props {
  aberto: boolean
  onOpenChange: (aberto: boolean) => void
  /** id_variante já na seleção de correção (não deixa adicionar de novo). */
  selecionadas: Set<number>
  onCorrigir: (d: DivergenciaSkuPedidos) => void
}

function Sku({ valor }: { valor: string | null }) {
  if (!valor) return <span className="text-muted-foreground">sem código</span>
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{valor}</code>
}

/** Variantes já vinculadas por SKU em que o produto do Bling pelo SKU é DIFERENTE do produto que as vendas
 * mostram. Pode ser SKU apontando pro produto errado — ou pareamento errado em pedido com vários itens: por
 * isso mostra quantos pedidos sustentam e deixa a decisão com a pessoa. */
export function DivergenciasSkuPedidosDialog({ aberto, onOpenChange, selecionadas, onCorrigir }: Props) {
  const [lista, setLista] = useState<DivergenciaSkuPedidos[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!aberto) return
    let ativo = true
    setCarregando(true)
    setErro(null)
    buscarDivergenciasSkuPedidos()
      .then((d) => ativo && setLista(d))
      .catch((e) => {
        console.error('Erro ao buscar divergências SKU × pedidos:', e)
        if (ativo) setErro('Não foi possível carregar as divergências.')
      })
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [aberto])

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Divergências SKU × pedidos</DialogTitle>
          <DialogDescription>
            Variantes já vinculadas por SKU, mas em que o vínculo do Bling (&quot;ID na loja&quot;) ou os pedidos mostram <strong>outro</strong> produto
            do Bling. Confira cada uma: pode ser SKU apontando para o produto errado — ou um erro de pareamento (principalmente quando só 1 pedido
            sustenta). Corrigir grava o código do outro produto na variante da Nuvemshop; o Bling não é alterado.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[28rem] overflow-y-auto">
          {carregando ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando...
            </div>
          ) : erro ? (
            <p className="p-8 text-center text-sm text-destructive">{erro}</p>
          ) : lista.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma divergência: os vínculos por SKU batem com os pedidos.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto na Nuvemshop</TableHead>
                  <TableHead>Bling pelo SKU</TableHead>
                  <TableHead>Bling pelo vínculo / vendas</TableHead>
                  <TableHead className="text-right">Evidência</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((d) => {
                  const semCodigo = !d.vendas_codigo || d.vendas_codigo.trim() === ''
                  const bloqueio = semCodigo
                    ? 'O outro produto não tem código no Bling.'
                    : d.qtd_variantes_ns > 0
                      ? 'Esse código já é usado por outra variante da Nuvemshop.'
                      : !d.vendas_ativo
                        ? 'O outro produto está inativo no Bling.'
                        : null
                  const jaAdicionada = selecionadas.has(d.id_variante)
                  return (
                    <TableRow key={d.id_variante}>
                      <TableCell>
                        <p className="max-w-56 truncate text-sm font-medium" title={d.nome_ns ?? undefined}>
                          {d.nome_ns}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {d.variacao_ns && `${d.variacao_ns} · `}SKU <Sku valor={d.sku_ns} />
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="max-w-56 truncate text-sm" title={d.sku_nome ?? undefined}>
                          {d.sku_nome}
                        </p>
                        <Sku valor={d.sku_codigo} />
                      </TableCell>
                      <TableCell>
                        <p className="max-w-56 truncate text-sm" title={d.vendas_nome ?? undefined}>
                          {d.vendas_nome}
                        </p>
                        <Sku valor={d.vendas_codigo} />
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {d.fonte === 'pedidos' ? `${d.pedidos} pedido${d.pedidos === 1 ? '' : 's'}` : d.fonte === 'vinculo' ? 'vínculo' : `vínculo + ${d.pedidos} ped.`}
                        {d.fonte === 'pedidos' && d.pedidos === 1 && <p className="text-xs text-amber-700 dark:text-amber-400">fraca</p>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!bloqueio || jaAdicionada}
                          title={bloqueio ?? undefined}
                          onClick={() => onCorrigir(d)}
                        >
                          {jaAdicionada ? 'Na seleção' : 'Usar este produto'}
                        </Button>
                        {bloqueio && <p className="mt-1 text-xs text-muted-foreground">{bloqueio}</p>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
