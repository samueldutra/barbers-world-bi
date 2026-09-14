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

interface Props {
  label: string
  opcoes: string[]
  valor: string | null
  onValorChange: (v: string | null) => void
  todosLabel?: string
  className?: string
}

/** Select buscável com opção "Todos" padrão — mesmo padrão do filtro de canal em
 * vendas-filtros.tsx, mas de seleção única. Compartilhado entre relatório de produtos
 * (marca/categoria) e relatório de clientes (UF/cidade). */
export function FiltroSelecaoUnica({ label, opcoes, valor, onValorChange, todosLabel = 'Todos', className }: Props) {
  const [aberto, setAberto] = useState(false)

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('w-44 justify-between font-normal', className)}>
          <span className="truncate">{valor ?? `${label}: ${todosLabel}`}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Buscar ${label.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>Nenhum resultado.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  onValorChange(null)
                  setAberto(false)
                }}
              >
                <Check className={cn('mr-2 h-4 w-4', !valor ? 'opacity-100' : 'opacity-0')} />
                {todosLabel}
              </CommandItem>
              {opcoes.map((opcao) => (
                <CommandItem
                  key={opcao}
                  onSelect={() => {
                    onValorChange(opcao)
                    setAberto(false)
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', valor === opcao ? 'opacity-100' : 'opacity-0')} />
                  {opcao}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
