'use client'

import Image from 'next/image'
import { Package, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { cn } from 'cn'
import { formatarMoeda, formatarNumero, formatarData, formatarDataHora, formatarPercentual } from '@/lib/formatters'
import type { LinhaConferencia, OrdenarConferenciaPor, OrdenarDirecao } from '@/hooks/use-conferencia-precos'

export interface AlteracaoPendente {
  linha: LinhaConferencia
  /** Texto do campo "Novo preço" (como digitado); vazio = selecionado sem preço definido. */
  preco: string
  origem: 'ultima_venda' | 'manual'
  erro?: string | null
}

interface Props {
  linhas: LinhaConferencia[]
  totalRegistros: number
  loading: boolean
  alteracoes: Map<number, AlteracaoPendente>
  onToggle: (linha: LinhaConferencia) => void
  onToggleTodos: (marcar: boolean) => void
  onPrecoChange: (linha: LinhaConferencia, texto: string) => void
  ordenarPor: OrdenarConferenciaPor
  ordenarDirecao: OrdenarDirecao
  onOrdenarChange: (coluna: OrdenarConferenciaPor) => void
  pagina: number
  tamanhoPagina: number
  onPaginaChange: (p: number) => void
  desabilitado: boolean
}

/** Cor da diferença entre última venda e cadastro: quanto maior o desvio, mais chama atenção. */
function classeDiferenca(dif: number | null): string {
  if (dif === null || Math.abs(dif) < 0.01) return 'text-muted-foreground'
  if (Math.abs(dif) >= 30) return 'font-semibold text-destructive'
  return dif < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-sky-600 dark:text-sky-400'
}

export function ConferenciaPrecosTabela({
  linhas,
  totalRegistros,
  loading,
  alteracoes,
  onToggle,
  onToggleTodos,
  onPrecoChange,
  ordenarPor,
  ordenarDirecao,
  onOrdenarChange,
  pagina,
  tamanhoPagina,
  onPaginaChange,
  desabilitado,
}: Props) {
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / tamanhoPagina))
  const inicio = totalRegistros === 0 ? 0 : (pagina - 1) * tamanhoPagina + 1
  const fim = Math.min(pagina * tamanhoPagina, totalRegistros)

  const selecionadosNaPagina = linhas.filter((l) => alteracoes.has(l.id_produto)).length
  const estadoCabecalho =
    selecionadosNaPagina === 0 ? false : selecionadosNaPagina === linhas.length ? true : 'indeterminate'

  const cabecalhoOrdenavel = (label: string, coluna: OrdenarConferenciaPor) => {
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
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : linhas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhum produto encontrado para este filtro.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={estadoCabecalho}
                      onCheckedChange={(v) => onToggleTodos(v === true)}
                      disabled={desabilitado}
                      aria-label="Selecionar todos da página"
                    />
                  </TableHead>
                  <TableHead>{cabecalhoOrdenavel('Produto', 'nome')}</TableHead>
                  <TableHead className="text-right">{cabecalhoOrdenavel('Preço atual', 'preco_atual')}</TableHead>
                  <TableHead className="text-right">{cabecalhoOrdenavel('Última venda', 'preco_ultima_venda')}</TableHead>
                  <TableHead className="text-right">{cabecalhoOrdenavel('Diferença', 'diferenca_percentual')}</TableHead>
                  <TableHead className="w-36 text-right">Novo preço</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((linha) => {
                  const alteracao = alteracoes.get(linha.id_produto)
                  const dif = linha.diferenca_percentual === null ? null : Number(linha.diferenca_percentual)
                  const desconto = Number(linha.desconto_ultima_venda ?? 0)
                  return (
                    <TableRow key={linha.id_produto} data-state={alteracao ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={!!alteracao}
                          onCheckedChange={() => onToggle(linha)}
                          disabled={desabilitado}
                          aria-label={`Selecionar ${linha.nome ?? linha.codigo ?? 'produto'}`}
                        />
                      </TableCell>
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
                            <p className="max-w-72 truncate text-sm font-medium" title={linha.nome ?? undefined}>
                              {linha.nome || 'Produto sem nome'}
                            </p>
                            <p className="max-w-72 truncate text-xs text-muted-foreground">
                              {linha.codigo || 'Sem SKU'} · {linha.marca || 'Sem marca'} · {linha.categoria_descricao || 'Sem categoria'}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <p className="font-medium tabular-nums">
                          {linha.preco_atual === null ? '—' : formatarMoeda(Number(linha.preco_atual))}
                        </p>
                        {linha.data_alteracao_preco && (
                          <p className="text-xs text-muted-foreground" title={`Alterado em ${formatarDataHora(linha.data_alteracao_preco)}`}>
                            antes {formatarMoeda(Number(linha.preco_anterior))} · {formatarData(new Date(linha.data_alteracao_preco))}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {linha.preco_ultima_venda === null ? (
                          <p className="text-xs text-muted-foreground">Sem venda no canal</p>
                        ) : (
                          <>
                            <p className="font-medium tabular-nums">{formatarMoeda(Number(linha.preco_ultima_venda))}</p>
                            {desconto > 0 && (
                              <p className="text-xs text-muted-foreground">
                                pago {formatarMoeda(Number(linha.valor_pago_ultima_venda))} (−{formatarPercentual(desconto)})
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {linha.data_ultima_venda && formatarData(linha.data_ultima_venda)} · {linha.canal_ultima_venda}
                              {linha.numero_pedido_ultima_venda !== null && ` · #${formatarNumero(linha.numero_pedido_ultima_venda)}`}
                            </p>
                          </>
                        )}
                      </TableCell>
                      <TableCell className={cn('text-right tabular-nums', classeDiferenca(dif))}>
                        {dif === null ? '—' : `${dif > 0 ? '+' : ''}${formatarPercentual(dif)}`}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          inputMode="decimal"
                          placeholder="0,00"
                          value={alteracao?.preco ?? ''}
                          onChange={(e) => onPrecoChange(linha, e.target.value)}
                          disabled={desabilitado}
                          aria-invalid={!!alteracao?.erro}
                          className="h-8 w-32 text-right tabular-nums"
                        />
                        {alteracao?.erro && <p className="mt-1 max-w-32 text-left text-xs text-destructive">{alteracao.erro}</p>}
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
