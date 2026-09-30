'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from 'cn'
import { formatarMoedaAbreviada, formatarNumero } from '@/lib/formatters'
import type { SituacaoPedido } from '@/hooks/use-situacoes-pedido'

interface Props {
  situacoes: SituacaoPedido[]
  /** null = filtro padrão (definido no banco — situacoes_validas_faturamento()). */
  situacoesSelecionadas: number[] | null
  onSituacoesChange: (ids: number[] | null) => void
  className?: string
}

function mesmoConjunto(a: number[], b: number[]) {
  return a.length === b.length && a.every((id) => b.includes(id))
}

/** Rótulo curto da seleção atual — também usado fora do filtro (linha de contexto). */
export function descreverSelecaoSituacoes(situacoes: SituacaoPedido[], selecionadas: number[] | null): string {
  const padrao = situacoes.filter((s) => s.padrao)
  if (!selecionadas) {
    return padrao.length === 1 ? `${padrao[0].nome} (padrão)` : 'Padrão'
  }
  if (situacoes.length > 0 && mesmoConjunto(selecionadas, situacoes.map((s) => s.id_situacao))) {
    return 'Todas as situações'
  }
  if (selecionadas.length === 1) {
    return situacoes.find((s) => s.id_situacao === selecionadas[0])?.nome ?? '1 situação'
  }
  return `${selecionadas.length} situações`
}

/** Seleção múltipla de situações de pedido. Começa no padrão (null); "Todas" seleciona
 * todas as situações conhecidas. Mostra o volume de cada situação no período filtrado
 * pra deixar claro o que está entrando (ou ficando de fora) do faturamento. */
export function FiltroSituacoes({ situacoes, situacoesSelecionadas, onSituacoesChange, className }: Props) {
  const [aberto, setAberto] = useState(false)

  const idsPadrao = situacoes.filter((s) => s.padrao).map((s) => s.id_situacao)
  const idsTodas = situacoes.map((s) => s.id_situacao)
  const efetivas = situacoesSelecionadas ?? idsPadrao
  const ehPadrao = situacoesSelecionadas === null
  const ehTodas = !ehPadrao && idsTodas.length > 0 && mesmoConjunto(efetivas, idsTodas)

  const aplicar = (ids: number[]) => {
    // Voltar exatamente ao conjunto padrão = modo padrão (null), pra não "congelar" uma
    // cópia do padrão caso ele mude no banco.
    if (ids.length === 0 || mesmoConjunto(ids, idsPadrao)) onSituacoesChange(null)
    else onSituacoesChange(ids)
  }

  const toggle = (id: number) => {
    aplicar(efetivas.includes(id) ? efetivas.filter((s) => s !== id) : [...efetivas, id])
  }

  const label = descreverSelecaoSituacoes(situacoes, situacoesSelecionadas)

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('w-56 justify-between font-normal', className)}>
          <span className="truncate">Situação: {label}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar situação..." />
          <CommandList className="max-h-80">
            <CommandEmpty>Nenhuma situação encontrada.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => onSituacoesChange(null)}>
                <Check className={cn('mr-2 h-4 w-4', ehPadrao ? 'opacity-100' : 'opacity-0')} />
                <div className="flex flex-col">
                  <span>Padrão</span>
                  <span className="text-xs text-muted-foreground">
                    {idsPadrao.length > 0
                      ? situacoes.filter((s) => s.padrao).map((s) => s.nome).join(', ')
                      : 'Situações que contam como venda'}
                  </span>
                </div>
              </CommandItem>
              <CommandItem onSelect={() => aplicar(idsTodas)}>
                <Check className={cn('mr-2 h-4 w-4', ehTodas ? 'opacity-100' : 'opacity-0')} />
                Todas as situações
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Situações (volume no período)">
              {situacoes.map((s) => (
                <CommandItem
                  key={s.id_situacao}
                  value={`${s.nome} ${s.nome_herdado ?? ''} ${s.id_situacao}`}
                  onSelect={() => toggle(s.id_situacao)}
                >
                  <Check className={cn('mr-2 h-4 w-4 shrink-0', efetivas.includes(s.id_situacao) ? 'opacity-100' : 'opacity-0')} />
                  <span
                    className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full border"
                    style={s.cor ? { backgroundColor: s.cor, borderColor: s.cor } : undefined}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">
                      {s.nome}
                      {s.padrao && <span className="ml-1 text-xs text-muted-foreground">· padrão</span>}
                      {s.cancelamento && <span className="ml-1 text-xs text-destructive">· cancelamento</span>}
                    </span>
                    {s.nome_herdado && (
                      <span className="truncate text-xs text-muted-foreground">herda de {s.nome_herdado}</span>
                    )}
                  </div>
                  <div className="ml-2 flex shrink-0 flex-col items-end text-xs tabular-nums text-muted-foreground">
                    <span>{formatarMoedaAbreviada(s.valor_periodo)}</span>
                    <span>{formatarNumero(s.pedidos_periodo)} ped.</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
