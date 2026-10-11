'use client'

import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, ExternalLink } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { cn } from 'cn'
import { formatarMoeda, formatarNumero } from '@/lib/formatters'
import { infoStatusVinculo } from '@/lib/vinculo-sku'
import type { LinhaVinculo, OrdenarDirecao, OrdenarVinculoPor } from '@/hooks/use-vinculo-sku'

interface Props {
  linhas: LinhaVinculo[]
  totalRegistros: number
  loading: boolean
  ordenarPor: OrdenarVinculoPor
  ordenarDirecao: OrdenarDirecao
  onOrdenarChange: (coluna: OrdenarVinculoPor) => void
  pagina: number
  tamanhoPagina: number
  onPaginaChange: (p: number) => void
}

/** SKU entre aspas quando tem espaço nas pontas — é o defeito que a tela precisa deixar visível. */
function SkuTexto({ sku }: { sku: string | null }) {
  if (!sku) return <span className="text-muted-foreground">—</span>
  const comEspaco = sku !== sku.trim()
  return (
    <code className={cn('rounded bg-muted px-1.5 py-0.5 text-xs', comEspaco && 'bg-sky-500/10 text-sky-700 dark:text-sky-400')}>
      {comEspaco ? `"${sku}"` : sku}
    </code>
  )
}

export function VinculoSkuTabela({
  linhas,
  totalRegistros,
  loading,
  ordenarPor,
  ordenarDirecao,
  onOrdenarChange,
  pagina,
  tamanhoPagina,
  onPaginaChange,
}: Props) {
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / tamanhoPagina))
  const inicio = totalRegistros === 0 ? 0 : (pagina - 1) * tamanhoPagina + 1
  const fim = Math.min(pagina * tamanhoPagina, totalRegistros)

  const cabecalhoOrdenavel = (label: string, coluna: OrdenarVinculoPor) => {
    const ativo = ordenarPor === coluna
    const Icone = ativo ? (ordenarDirecao === 'desc' ? ArrowDown : ArrowUp) : ArrowUpDown
    return (
      <button type="button" onClick={() => onOrdenarChange(coluna)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        <Icone className={`h-3.5 w-3.5 ${ativo ? 'text-foreground' : 'text-muted-foreground/50'}`} />
      </button>
    )
  }

  return (
    <Card>
      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : linhas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum item para este filtro. Se a tabela de produtos da Nuvemshop ainda estiver vazia, rode o ETL
            (&quot;Nuvemshop (catálogo de produtos)&quot;) antes.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{cabecalhoOrdenavel('Status', 'status')}</TableHead>
                  <TableHead>{cabecalhoOrdenavel('Produto na Nuvemshop', 'nome')}</TableHead>
                  <TableHead>{cabecalhoOrdenavel('SKU Nuvemshop', 'sku')}</TableHead>
                  <TableHead>Produto no Bling</TableHead>
                  <TableHead>SKU Bling</TableHead>
                  <TableHead className="text-right">Preço Nuvemshop</TableHead>
                  <TableHead className="text-right">Preço Bling</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((linha) => {
                  const info = infoStatusVinculo(linha.status)
                  return (
                    <TableRow key={`${linha.visao}-${linha.id_variante ?? linha.id_produto_bling}`}>
                      <TableCell>
                        <span
                          title={info.descricao}
                          className={cn('inline-flex h-5 items-center rounded-4xl px-2 text-xs font-medium whitespace-nowrap', info.classe)}
                        >
                          {info.label}
                        </span>
                        {linha.publicado === false && <p className="mt-1 text-xs text-muted-foreground">Não publicado</p>}
                      </TableCell>
                      <TableCell>
                        {linha.visao === 'nuvemshop' ? (
                          <div className="min-w-0">
                            <p className="flex max-w-80 items-center gap-1 text-sm font-medium" title={linha.nome_ns ?? undefined}>
                              <span className="truncate">{linha.nome_ns || 'Produto sem nome'}</span>
                              {linha.url_ns && (
                                <a href={linha.url_ns} target="_blank" rel="noreferrer" aria-label="Abrir na loja" className="shrink-0 text-muted-foreground hover:text-foreground">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </p>
                            {linha.variacao_ns && <p className="max-w-80 truncate text-xs text-muted-foreground">{linha.variacao_ns}</p>}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{linha.visao === 'nuvemshop' ? <SkuTexto sku={linha.sku_ns} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        {linha.nome_bling ? (
                          <p className="max-w-80 truncate text-sm" title={linha.nome_bling}>
                            {linha.nome_bling}
                          </p>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <SkuTexto sku={linha.codigo_bling} />
                        {linha.status === 'sku_duplicado' && linha.qtd_bling > 1 && (
                          <p className="mt-1 text-xs text-muted-foreground">{linha.qtd_bling} produtos no Bling</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {linha.preco_ns === null ? (
                          '—'
                        ) : (
                          <>
                            <p className={cn(linha.preco_promocional_ns !== null && 'text-xs text-muted-foreground line-through')}>
                              {formatarMoeda(Number(linha.preco_ns))}
                            </p>
                            {linha.preco_promocional_ns !== null && <p className="font-medium">{formatarMoeda(Number(linha.preco_promocional_ns))}</p>}
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {linha.preco_bling === null ? '—' : formatarMoeda(Number(linha.preco_bling))}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Mostrando {inicio}–{fim} de {formatarNumero(totalRegistros)} itens
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => onPaginaChange(pagina - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Button>
                <span className="text-xs text-muted-foreground">
                  Página {pagina} de {totalPaginas}
                </span>
                <Button variant="outline" size="sm" disabled={pagina >= totalPaginas} onClick={() => onPaginaChange(pagina + 1)}>
                  Próxima
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
