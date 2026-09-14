'use client'

import { User, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Download, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatarMoeda, formatarNumero, formatarData } from '@/lib/formatters'
import type { LinhaRelatorioCliente, OrdenarClientesPor, OrdenarDirecao, StatusCliente } from '@/hooks/use-relatorio-clientes'

const VARIANTE_POR_STATUS: Record<StatusCliente, 'default' | 'secondary' | 'outline'> = {
  Novo: 'default',
  Recorrente: 'secondary',
  'Não identificado': 'outline',
}

interface Props {
  linhas: LinhaRelatorioCliente[]
  totalRegistros: number
  loading: boolean
  busca: string
  onBuscaChange: (v: string) => void
  ordenarPor: OrdenarClientesPor
  ordenarDirecao: OrdenarDirecao
  onOrdenarChange: (coluna: OrdenarClientesPor) => void
  pagina: number
  tamanhoPagina: number
  onPaginaChange: (p: number) => void
  onExportar: (formato: 'csv' | 'xlsx') => void
  exportando: boolean
}

export function RelatorioClientesTabela({
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

  const cabecalhoOrdenavel = (label: string, coluna: OrdenarClientesPor) => {
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
          <CardTitle>Vendas por cliente</CardTitle>
          <CardDescription>Listagem detalhada — ordene por pedidos, valor vendido ou ticket médio</CardDescription>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input
            placeholder="Buscar por nome ou CPF/CNPJ..."
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
                  <TableHead>Cliente</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Cidade/UF</TableHead>
                  <TableHead className="text-right">{cabecalhoOrdenavel('Pedidos', 'qtde_pedidos')}</TableHead>
                  <TableHead className="text-right">{cabecalhoOrdenavel('Valor vendido', 'valor_vendido')}</TableHead>
                  <TableHead className="text-right">{cabecalhoOrdenavel('Ticket médio', 'ticket_medio')}</TableHead>
                  <TableHead className="text-right">Última compra</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((linha, index) => (
                  <TableRow key={`${linha.id_contato ?? linha.documento_contato ?? 'cliente'}-${index}`}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                          <User className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="max-w-56 truncate text-sm font-medium">{linha.nome_contato || 'Cliente sem nome'}</p>
                          {linha.email && <p className="max-w-56 truncate text-xs text-muted-foreground">{linha.email}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={VARIANTE_POR_STATUS[linha.status_cliente]}>{linha.status_cliente}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{linha.documento_contato || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[linha.municipio, linha.uf].filter(Boolean).join('/') || '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatarNumero(Number(linha.total_pedidos))}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatarMoeda(Number(linha.faturamento))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatarMoeda(Number(linha.ticket_medio))}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                      {linha.ultima_compra ? formatarData(linha.ultima_compra) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Mostrando {inicio}–{fim} de {formatarNumero(totalRegistros)} clientes
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
