'use client'

import Image from 'next/image'
import { Package, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Download, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatarMoeda, formatarNumero } from '@/lib/formatters'
import type { LinhaRelatorioProduto, OrdenarRelatorioPor, OrdenarDirecao } from '@/hooks/use-relatorio-produtos'

interface Props {
  linhas: LinhaRelatorioProduto[]
  totalRegistros: number
  loading: boolean
  busca: string
  onBuscaChange: (v: string) => void
  ordenarPor: OrdenarRelatorioPor
  ordenarDirecao: OrdenarDirecao
  onOrdenarChange: (coluna: OrdenarRelatorioPor) => void
  pagina: number
  tamanhoPagina: number
  onPaginaChange: (p: number) => void
  onExportar: (formato: 'csv' | 'xlsx') => void
  exportando: boolean
}

export function RelatorioProdutosTabela({
  linhas,
  totalRegistros,
  loading,
  busca,
  onBuscaChange,
  ordenarPor,
  ordenarDirecao,
  onOrdenarChange,
  pagina,
  tamanhoPagina,
  onPaginaChange,
  onExportar,
  exportando,
}: Props) {
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / tamanhoPagina))
  const inicio = totalRegistros === 0 ? 0 : (pagina - 1) * tamanhoPagina + 1
  const fim = Math.min(pagina * tamanhoPagina, totalRegistros)

  const cabecalhoOrdenavel = (label: string, coluna: OrdenarRelatorioPor) => {
    const ativo = ordenarPor === coluna
    const Icone = ativo ? (ordenarDirecao === 'desc' ? ArrowDown : ArrowUp) : ArrowUpDown
    return (
      <button
        type="button"
        onClick={() => onOrdenarChange(coluna)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icone className={`h-3.5 w-3.5 ${ativo ? 'text-foreground' : 'text-muted-foreground/50'}`} />
      </button>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Vendas por produto</CardTitle>
          <CardDescription>Listagem detalhada — ordene por quantidade ou valor vendido</CardDescription>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input
            placeholder="Buscar por nome, código ou descrição..."
            value={busca}
            onChange={(e) => onBuscaChange(e.target.value)}
            className="w-full sm:w-72"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={exportando || totalRegistros === 0}>
                {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onExportar('csv')}>Exportar CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExportar('xlsx')}>Exportar XLSX</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : linhas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma venda encontrada para este período/filtro.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Marca</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">{cabecalhoOrdenavel('Qtde vendida', 'qtde_vendida')}</TableHead>
                  <TableHead className="text-right">{cabecalhoOrdenavel('Valor vendido', 'valor_vendido')}</TableHead>
                  <TableHead className="text-right">Pedidos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((linha, index) => (
                  <TableRow key={`${linha.id_produto ?? linha.codigo ?? 'produto'}-${index}`}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                          {linha.imagem_url ? (
                            <Image src={linha.imagem_url} alt={linha.nome || ''} width={36} height={36} className="h-full w-full object-cover" unoptimized />
                          ) : (
                            <Package className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="max-w-64 truncate text-sm font-medium">{linha.nome || 'Produto sem nome'}</p>
                          <p className="text-xs text-muted-foreground">{linha.codigo || 'Sem SKU'}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{linha.marca || 'Sem marca'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{linha.categoria_descricao || 'Sem categoria'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatarNumero(Number(linha.unidades_vendidas))}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatarMoeda(Number(linha.faturamento))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatarNumero(Number(linha.pedidos))}</TableCell>
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
        )}
      </CardContent>
    </Card>
  )
}
