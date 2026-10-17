'use client'

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { ProdutoImagem } from '@/components/produto-imagem'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatarMoeda, formatarNumero, formatarPercentual } from '@/lib/formatters'
import type { OrdenarCatalogoPor, OrdenarDirecao, ProdutoCatalogo } from '@/hooks/use-gestao-produtos'

interface Props {
  linhas: ProdutoCatalogo[]
  totalRegistros: number
  loading: boolean
  ordenarPor: OrdenarCatalogoPor
  ordenarDirecao: OrdenarDirecao
  onOrdenarChange: (coluna: OrdenarCatalogoPor) => void
  pagina: number
  tamanhoPagina: number
  onPaginaChange: (p: number) => void
}

function StatusNuvemshop({ p }: { p: ProdutoCatalogo }) {
  if (p.ns_variantes === 0) return <Badge variant="outline">Fora da loja</Badge>
  const rotulo = p.ns_publicado ? 'Publicado' : 'Despublicado'
  return (
    <div className="flex items-center gap-1.5">
      <Badge variant={p.ns_publicado ? 'secondary' : 'outline'}>{rotulo}</Badge>
      {p.ns_url && (
        <a
          href={p.ns_url}
          target="_blank"
          rel="noreferrer"
          aria-label="Abrir na loja"
          className="text-muted-foreground hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  )
}

export function CatalogoTabela({
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

  const cabecalhoOrdenavel = (label: string, coluna: OrdenarCatalogoPor) => {
    const ativo = ordenarPor === coluna
    const Icone = ativo ? (ordenarDirecao === 'desc' ? ArrowDown : ArrowUp) : ArrowUpDown
    return (
      <button type="button" onClick={() => onOrdenarChange(coluna)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        <Icone className={`h-3.5 w-3.5 ${ativo ? 'text-foreground' : 'text-muted-foreground/50'}`} />
      </button>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (linhas.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum produto encontrado para este filtro.</p>
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{cabecalhoOrdenavel('Produto', 'nome')}</TableHead>
            <TableHead>{cabecalhoOrdenavel('Marca', 'marca')}</TableHead>
            <TableHead className="text-right">{cabecalhoOrdenavel('Custo', 'custo')}</TableHead>
            <TableHead className="text-right">{cabecalhoOrdenavel('Preço de venda', 'preco')}</TableHead>
            <TableHead className="text-right">{cabecalhoOrdenavel('Margem bruta', 'margem')}</TableHead>
            <TableHead className="text-right">{cabecalhoOrdenavel('Estoque', 'estoque')}</TableHead>
            <TableHead>Nuvemshop</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((p) => (
            <TableRow key={p.id_produto}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <ProdutoImagem src={p.imagem_url} alt={p.nome || ''} tamanho={36} />
                  <div className="min-w-0">
                    <p className="max-w-72 truncate text-sm font-medium">{p.nome || 'Produto sem nome'}</p>
                    <p className="text-xs text-muted-foreground">{p.codigo || 'Sem SKU'}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{p.marca || 'Sem marca'}</TableCell>
              <TableCell className="text-right tabular-nums">
                {p.preco_custo == null ? <span className="text-muted-foreground">—</span> : formatarMoeda(Number(p.preco_custo))}
              </TableCell>
              <TableCell className="text-right tabular-nums font-medium">{formatarMoeda(Number(p.preco ?? 0))}</TableCell>
              <TableCell className="text-right tabular-nums">
                {p.margem_pct == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <>
                    <p className={Number(p.margem_pct) < 0 ? 'font-medium text-destructive' : 'font-medium'}>
                      {formatarPercentual(Number(p.margem_pct))}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatarMoeda(Number(p.margem_valor))}</p>
                  </>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {p.saldo_virtual == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className={Number(p.saldo_virtual) <= 0 ? 'font-medium text-destructive' : undefined}>
                    {formatarNumero(Number(p.saldo_virtual))}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <StatusNuvemshop p={p} />
              </TableCell>
            </TableRow>
          ))}
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
  )
}
