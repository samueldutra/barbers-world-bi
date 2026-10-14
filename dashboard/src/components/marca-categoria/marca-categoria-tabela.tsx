'use client'

import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, ExternalLink } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { cn } from 'cn'
import { formatarNumero } from '@/lib/formatters'
import type { OrdenarDirecao, OrdenarMarcaCategoriaPor, ProdutoMarcaCategoria } from '@/hooks/use-marca-categoria'

interface Props {
  linhas: ProdutoMarcaCategoria[]
  totalRegistros: number
  loading: boolean
  ordenarPor: OrdenarMarcaCategoriaPor
  ordenarDirecao: OrdenarDirecao
  onOrdenarChange: (coluna: OrdenarMarcaCategoriaPor) => void
  pagina: number
  tamanhoPagina: number
  onPaginaChange: (p: number) => void
  selecionados: Map<number, ProdutoMarcaCategoria>
  onToggle: (produto: ProdutoMarcaCategoria) => void
  onToggleTodosPagina: (marcar: boolean) => void
  /** Mensagem de erro da última gravação, por produto. */
  erros: Map<number, string>
  desabilitado: boolean
}

export function MarcaCategoriaTabela({
  linhas, totalRegistros, loading, ordenarPor, ordenarDirecao, onOrdenarChange, pagina, tamanhoPagina, onPaginaChange,
  selecionados, onToggle, onToggleTodosPagina, erros, desabilitado,
}: Props) {
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / tamanhoPagina))
  const inicio = totalRegistros === 0 ? 0 : (pagina - 1) * tamanhoPagina + 1
  const fim = Math.min(pagina * tamanhoPagina, totalRegistros)

  const selecionadosNaPagina = linhas.filter((l) => selecionados.has(l.id_produto_ns)).length
  const estadoCabecalho = selecionadosNaPagina === 0 ? false : selecionadosNaPagina === linhas.length ? true : 'indeterminate'

  const cabecalhoOrdenavel = (label: string, coluna: OrdenarMarcaCategoriaPor) => {
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
            Nenhum produto para este filtro. Se a tabela de produtos da Nuvemshop ainda estiver vazia, rode o ETL
            (&quot;Nuvemshop (catálogo de produtos)&quot;) antes.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={estadoCabecalho}
                      onCheckedChange={(v) => onToggleTodosPagina(v === true)}
                      disabled={desabilitado}
                      aria-label="Selecionar todos os produtos da página"
                    />
                  </TableHead>
                  <TableHead>{cabecalhoOrdenavel('Produto na Nuvemshop', 'nome')}</TableHead>
                  <TableHead>{cabecalhoOrdenavel('Marca', 'marca')}</TableHead>
                  <TableHead>Categorias</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((p) => {
                  const erro = erros.get(p.id_produto_ns)
                  return (
                    <TableRow key={p.id_produto_ns} data-state={selecionados.has(p.id_produto_ns) ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selecionados.has(p.id_produto_ns)}
                          onCheckedChange={() => onToggle(p)}
                          disabled={desabilitado}
                          aria-label={`Selecionar ${p.nome ?? 'produto'}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {p.imagem_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.imagem_url} alt="" className="h-10 w-10 shrink-0 rounded-md border object-cover" loading="lazy" />
                          ) : (
                            <div className="h-10 w-10 shrink-0 rounded-md border bg-muted" />
                          )}
                          <div className="min-w-0">
                            <p className="flex max-w-96 items-center gap-1 text-sm font-medium" title={p.nome ?? undefined}>
                              <span className="truncate">{p.nome || 'Produto sem nome'}</span>
                              {p.url && (
                                <a href={p.url} target="_blank" rel="noreferrer" aria-label="Abrir na loja" className="shrink-0 text-muted-foreground hover:text-foreground">
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </p>
                            <p className="max-w-96 truncate text-xs text-muted-foreground">
                              {p.sku_exemplo ? <code>{p.sku_exemplo}</code> : 'sem SKU'}
                              {p.qtd_variantes > 1 && ` · ${p.qtd_variantes} variantes`}
                              {p.publicado === false && ' · não publicado'}
                            </p>
                            {erro && <p className="mt-1 max-w-96 text-xs text-destructive">{erro}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {p.marca ? (
                          <span className="inline-flex h-5 items-center rounded-4xl bg-muted px-2 text-xs font-medium whitespace-nowrap" title={p.marca !== p.marca.trim() ? 'Tem espaço no fim' : undefined}>
                            {p.marca !== p.marca.trim() ? `"${p.marca}"` : p.marca}
                          </span>
                        ) : (
                          <span className="inline-flex h-5 items-center rounded-4xl bg-destructive/10 px-2 text-xs font-medium whitespace-nowrap text-destructive">
                            Sem marca
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {p.categorias.length === 0 ? (
                          <span className="inline-flex h-5 items-center rounded-4xl bg-destructive/10 px-2 text-xs font-medium whitespace-nowrap text-destructive">
                            Sem categoria
                          </span>
                        ) : (
                          <div className="flex max-w-xl flex-wrap gap-1">
                            {p.categorias.map((c) => (
                              <span
                                key={c.id}
                                title={c.caminho}
                                className={cn('inline-flex h-5 items-center rounded-4xl bg-sky-500/10 px-2 text-xs font-medium whitespace-nowrap text-sky-700 dark:text-sky-400')}
                              >
                                {c.caminho.includes(' › ') ? `… › ${c.nome}` : c.nome}
                              </span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Mostrando {inicio}–{fim} de {formatarNumero(totalRegistros)} produtos
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
