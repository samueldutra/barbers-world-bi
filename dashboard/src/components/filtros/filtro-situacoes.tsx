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
  /** null = filtro padrão (definido no banco — situacoes_padrao_dashboard()). */
  situacoesSelecionadas: number[] | null
  onSituacoesChange: (ids: number[] | null) => void
  className?: string
}

function mesmoConjunto(a: number[], b: number[]) {
  return a.length === b.length && a.every((id) => b.includes(id))
}

/** Só entram na lista as situações com valor no período/canais carregados — as zeradas
 * não mudam nenhum número do dashboard e só poluíam o filtro. */
function situacoesComValor(situacoes: SituacaoPedido[]) {
  return situacoes.filter((s) => s.valor_periodo > 0)
}

/** "Todas" = todas as situações com valor no período estão selecionadas (a seleção pode
 * ter ids extras, de um período anterior, sem valor neste). */
function selecionouTodas(situacoes: SituacaoPedido[], selecionadas: number[]) {
  const visiveis = situacoesComValor(situacoes)
  return visiveis.length > 0 && visiveis.every((s) => selecionadas.includes(s.id_situacao))
}

/** Rótulo curto da seleção atual — também usado fora do filtro (linha de contexto). */
export function descreverSelecaoSituacoes(situacoes: SituacaoPedido[], selecionadas: number[] | null): string {
  if (!selecionadas) return 'Padrão'
  if (selecionouTodas(situacoes, selecionadas)) {
    return 'Todas as situações'
  }
  if (selecionadas.length === 1) {
    return situacoes.find((s) => s.id_situacao === selecionadas[0])?.nome ?? '1 situação'
  }
  return `${selecionadas.length} situações`
}

/** Seleção múltipla de situações de pedido. Começa no padrão (null); "Todas" seleciona
 * todas as situações com valor no período. Mostra o volume de cada situação no período
 * filtrado pra deixar claro o que está entrando (ou ficando de fora) do faturamento. */
export function FiltroSituacoes({ situacoes, situacoesSelecionadas, onSituacoesChange, className }: Props) {
  const [aberto, setAberto] = useState(false)

  const idsPadrao = situacoes.filter((s) => s.padrao).map((s) => s.id_situacao)
  const visiveis = situacoesComValor(situacoes)
  const idsTodas = visiveis.map((s) => s.id_situacao)
  const efetivas = situacoesSelecionadas ?? idsPadrao
  const ehPadrao = situacoesSelecionadas === null
  const ehTodas = !ehPadrao && selecionouTodas(situacoes, efetivas)

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
                    Todas, exceto Cancelado, Em aberto e as que herdam de Em aberto
                  </span>
                </div>
              </CommandItem>
              <CommandItem onSelect={() => aplicar(idsTodas)}>
                <Check className={cn('mr-2 h-4 w-4', ehTodas ? 'opacity-100' : 'opacity-0')} />
                Todas as situações
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Situações com vendas no período">
              {visiveis.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted-foreground">Nenhuma situação com valor no período.</p>
              )}
              {visiveis.map((s) => (
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
