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
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from 'cn'
import type { CanalVenda } from '@/hooks/use-canais-venda'

interface Props {
  canais: CanalVenda[]
  canaisSelecionados: number[] | null
  onCanaisChange: (ids: number[] | null) => void
  /** Prefixo opcional no botão (ex.: "Referência") pra deixar claro o papel do filtro. */
  prefixo?: string
  className?: string
}

/** Seleção múltipla de canais de venda, com "Todos os canais" = null. Compartilhado entre
 * os filtros de vendas e a conferência de preços. */
export function FiltroCanais({ canais, canaisSelecionados, onCanaisChange, prefixo, className }: Props) {
  const [aberto, setAberto] = useState(false)

  const toggleCanal = (id: number) => {
    const atuais = canaisSelecionados ?? []
    const novo = atuais.includes(id) ? atuais.filter((c) => c !== id) : [...atuais, id]
    onCanaisChange(novo.length === 0 ? null : novo)
  }

  const labelCanais =
    !canaisSelecionados || canaisSelecionados.length === 0
      ? 'Todos os canais'
      : canaisSelecionados.length === 1
        ? canais.find((c) => c.id_loja === canaisSelecionados[0])?.descricao || '1 canal'
        : `${canaisSelecionados.length} canais`

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('w-52 justify-between font-normal', className)}>
          <span className="truncate">{prefixo ? `${prefixo}: ${labelCanais}` : labelCanais}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar canal..." />
          <CommandList>
            <CommandEmpty>Nenhum canal encontrado.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => onCanaisChange(null)}>
                <Check className={cn('mr-2 h-4 w-4', !canaisSelecionados ? 'opacity-100' : 'opacity-0')} />
                Todos os canais
              </CommandItem>
              {canais.map((canal) => (
                <CommandItem key={canal.id_loja} onSelect={() => toggleCanal(canal.id_loja)}>
                  <Check
                    className={cn('mr-2 h-4 w-4', canaisSelecionados?.includes(canal.id_loja) ? 'opacity-100' : 'opacity-0')}
                  />
                  {canal.descricao || `Canal ${canal.id_loja}`}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
