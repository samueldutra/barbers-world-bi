'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { confiancaSugestao, type OrigemAlteracaoSku } from '@/lib/vinculo-sku'
import type { LinhaVinculo } from '@/hooks/use-vinculo-sku'

export interface AlteracaoSkuConfirmada {
  linha: LinhaVinculo
  skuNovo: string
  origem: OrigemAlteracaoSku
  /** Nome do produto do Bling escolhido (quando veio do seletor ou da sugestão). */
  nomeBling?: string | null
}

/** Abaixo disso (ou digitado à mão) a alteração é destacada: o par pode não ser o mesmo produto. */
export const SCORE_CONFIANCA_MINIMA = 0.8

/** Alteração que merece conferência extra: digitada à mão, ou sugestão por nome com pouca similaridade. */
export function exigeAtencao(item: AlteracaoSkuConfirmada): boolean {
  if (item.origem === 'ajuste' || item.origem === 'escolha') return false
  if (item.origem === 'manual') return true
  return item.linha.sugestao_score === null || Number(item.linha.sugestao_score) < SCORE_CONFIANCA_MINIMA
}

function criterio(item: AlteracaoSkuConfirmada): { label: string; classe: string } {
  if (item.origem === 'ajuste') return { label: 'Só espaço/maiúscula', classe: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' }
  if (item.origem === 'escolha') return { label: 'Escolhido por você', classe: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' }
  if (item.origem === 'manual') return { label: 'Digitado', classe: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' }
  return confiancaSugestao(Number(item.linha.sugestao_score ?? 0))
}

interface Props {
  aberto: boolean
  onOpenChange: (aberto: boolean) => void
  itens: AlteracaoSkuConfirmada[]
  aplicando: boolean
  progresso: { feitos: number; total: number }
  onConfirmar: () => void
}

export function ConfirmarAlteracoesSkuDialog({ aberto, onOpenChange, itens, aplicando, progresso, onConfirmar }: Props) {
  const atencao = itens.filter(exigeAtencao).length
  // Mesmo SKU novo em mais de uma variante: a primeira é gravada; as demais são recusadas (o SKU passaria a
  // existir em duas variantes da loja).
  const contagem = new Map<string, number>()
  for (const it of itens) contagem.set(it.skuNovo.trim().toUpperCase(), (contagem.get(it.skuNovo.trim().toUpperCase()) ?? 0) + 1)
  const repetidos = [...contagem.values()].filter((n) => n > 1).length

  return (
    <Dialog open={aberto} onOpenChange={(v) => !aplicando && onOpenChange(v)}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Corrigir o SKU de {itens.length} variante(s) na Nuvemshop</DialogTitle>
          <DialogDescription>
            O SKU da variante na Nuvemshop passa a ser o código do Bling. Só o SKU é alterado — preço, estoque e demais
            dados não mudam. A alteração vale na loja na hora.
          </DialogDescription>
        </DialogHeader>

        {atencao > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {atencao} item(ns) digitado(s) à mão ou com sugestão de baixa confiança — confira se o produto do Bling é
              mesmo o mesmo da loja (cor, tamanho, modelo).
            </span>
          </div>
        )}

        {repetidos > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {repetidos} SKU(s) novo(s) aparecem em mais de uma variante da seleção (ex.: cores do mesmo produto). Só a
              primeira de cada será gravada; as outras serão recusadas para não duplicar o SKU na loja.
            </span>
          </div>
        )}

        <div className="max-h-96 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto na Nuvemshop</TableHead>
                <TableHead>SKU atual → novo</TableHead>
                <TableHead>Produto no Bling</TableHead>
                <TableHead>Critério</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map((item) => {
                const { linha, skuNovo } = item
                const c = criterio(item)
                const nomeBling = item.nomeBling ?? (linha.status === 'vinculado_ajustar' ? linha.nome_bling : linha.sugestao_nome)
                return (
                  <TableRow key={linha.id_variante} className={cn(exigeAtencao(item) && 'bg-amber-500/5')}>
                    <TableCell>
                      <p className="max-w-64 truncate text-sm font-medium" title={linha.nome_ns ?? undefined}>
                        {linha.nome_ns || 'Produto sem nome'}
                      </p>
                      {linha.variacao_ns && <p className="text-xs text-muted-foreground">{linha.variacao_ns}</p>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <code className="rounded bg-muted px-1.5 py-0.5">{linha.sku_ns ? `"${linha.sku_ns}"` : 'sem SKU'}</code>
                        <span className="text-muted-foreground">→</span>
                        <code className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400">{skuNovo}</code>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-64 truncate text-sm" title={nomeBling ?? undefined}>
                        {nomeBling ?? <span className="text-muted-foreground">validado ao gravar</span>}
                      </p>
                    </TableCell>
                    <TableCell>
                      <span className={cn('inline-flex h-5 items-center rounded-4xl px-2 text-xs font-medium whitespace-nowrap', c.classe)}>
                        {c.label}
                      </span>
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
              Gravando na Nuvemshop: {progresso.feitos} de {progresso.total}...
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={aplicando}>
            Cancelar
          </Button>
          <Button onClick={onConfirmar} disabled={aplicando || itens.length === 0}>
            {aplicando && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar correção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
