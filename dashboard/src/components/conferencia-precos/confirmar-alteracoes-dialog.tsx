'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { cn } from 'cn'
import { formatarMoeda, formatarPercentual } from '@/lib/formatters'
import type { LinhaConferencia } from '@/hooks/use-conferencia-precos'

export interface AlteracaoConfirmada {
  linha: LinhaConferencia
  precoNovo: number
  origem: 'ultima_venda' | 'manual'
}

/** Variação acima disso (pra cima ou pra baixo) é destacada antes de gravar no Bling. */
export const LIMITE_VARIACAO_ALERTA = 30

export function variacaoPercentual(precoAtual: number | null, precoNovo: number): number | null {
  if (!precoAtual || precoAtual <= 0) return null
  return (precoNovo / precoAtual - 1) * 100
}

interface Props {
  aberto: boolean
  onOpenChange: (aberto: boolean) => void
  itens: AlteracaoConfirmada[]
  aplicando: boolean
  progresso: { feitos: number; total: number }
  onConfirmar: () => void
}

export function ConfirmarAlteracoesDialog({ aberto, onOpenChange, itens, aplicando, progresso, onConfirmar }: Props) {
  const grandes = itens.filter((i) => {
    const v = variacaoPercentual(Number(i.linha.preco_atual), i.precoNovo)
    return v !== null && Math.abs(v) >= LIMITE_VARIACAO_ALERTA
  }).length

  return (
    <Dialog open={aberto} onOpenChange={(v) => !aplicando && onOpenChange(v)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Alterar preço de {itens.length} produto(s) no Bling</DialogTitle>
          <DialogDescription>
            O preço de venda do cadastro será gravado direto no Bling. Confira antes de confirmar.
          </DialogDescription>
        </DialogHeader>

        {grandes > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {grandes} produto(s) com variação de {LIMITE_VARIACAO_ALERTA}% ou mais em relação ao preço atual — destacados abaixo.
            </span>
          </div>
        )}

        <div className="max-h-96 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Atual</TableHead>
                <TableHead className="text-right">Novo</TableHead>
                <TableHead className="text-right">Variação</TableHead>
                <TableHead>Critério</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map(({ linha, precoNovo, origem }) => {
                const v = variacaoPercentual(Number(linha.preco_atual), precoNovo)
                const grande = v !== null && Math.abs(v) >= LIMITE_VARIACAO_ALERTA
                return (
                  <TableRow key={linha.id_produto} className={cn(grande && 'bg-destructive/5')}>
                    <TableCell>
                      <p className="max-w-64 truncate text-sm font-medium">{linha.nome || 'Produto sem nome'}</p>
                      <p className="text-xs text-muted-foreground">{linha.codigo || 'Sem SKU'}</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {linha.preco_atual === null ? '—' : formatarMoeda(Number(linha.preco_atual))}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatarMoeda(precoNovo)}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', grande && 'font-semibold text-destructive')}>
                      {v === null ? '—' : `${v > 0 ? '+' : ''}${formatarPercentual(v)}`}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{origem === 'ultima_venda' ? 'Última venda' : 'Digitado'}</Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {aplicando && (
          <div className="flex flex-col gap-2">
            <Progress value={progresso.total ? (progresso.feitos / progresso.total) * 100 : 0} />
            <p className="text-xs text-muted-foreground">
              Gravando no Bling: {progresso.feitos} de {progresso.total}...
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={aplicando}>
            Cancelar
          </Button>
          <Button onClick={onConfirmar} disabled={aplicando || itens.length === 0}>
            {aplicando && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar alteração
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
