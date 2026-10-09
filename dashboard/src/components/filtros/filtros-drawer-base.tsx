'use client'

import { useState } from 'react'
import { ArrowLeft, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'

interface Props<T> {
  /** Filtros hoje aplicados. */
  valor: T
  /** Chamado só em "Aplicar", com o rascunho. */
  onAplicar: (novo: T) => void
  /** Quantos filtros do valor aplicado estão fora do padrão (vira o contador do botão). */
  contar: (valor: T) => number
  /** Campos do drawer, trabalhando no rascunho. */
  children: (rascunho: T, atualizar: (parcial: Partial<T>) => void) => React.ReactNode
}

/** Botão "Filtrar" (com o número de filtros aplicados) que abre o drawer "Filtros" pela direita:
 * voltar (descarta), campos, Aplicar e Cancelar. As escolhas ficam num rascunho — só viram filtro
 * em "Aplicar"; voltar, Cancelar, Esc ou clicar fora descartam. Padrão de filtros do Dashboard
 * e dos relatórios. */
export function FiltrosDrawerBase<T>({ valor, onAplicar, contar, children }: Props<T>) {
  const [aberto, setAberto] = useState(false)
  const [rascunho, setRascunho] = useState<T>(valor)

  const aplicados = contar(valor)

  const aoMudarAberto = (abrir: boolean) => {
    // Abre sempre a partir do que está aplicado (descarta rascunhos anteriores).
    if (abrir) setRascunho(valor)
    setAberto(abrir)
  }

  const aplicar = () => {
    onAplicar(rascunho)
    setAberto(false)
  }

  return (
    <Drawer open={aberto} onOpenChange={aoMudarAberto} direction="right">
      <DrawerTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal data-icon="inline-start" />
          Filtrar
          {aplicados > 0 && (
            <span
              aria-label={`${aplicados} filtro(s) aplicado(s)`}
              className="flex size-4 items-center justify-center rounded-full bg-primary text-[0.65rem] leading-none font-medium text-primary-foreground"
            >
              {aplicados}
            </span>
          )}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="gap-3">
          <DrawerClose asChild>
            <Button variant="ghost" size="icon-sm" className="-ml-2 w-fit" aria-label="Voltar sem aplicar os filtros">
              <ArrowLeft />
            </Button>
          </DrawerClose>
          <div className="flex flex-col gap-0.5">
            <DrawerTitle className="text-lg">Filtros</DrawerTitle>
            <DrawerDescription>Escolha e clique em Aplicar para atualizar a tela.</DrawerDescription>
          </div>
        </DrawerHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
          {children(rascunho, (parcial) => setRascunho((atual) => ({ ...atual, ...parcial })))}
        </div>

        <DrawerFooter className="border-t">
          <Button onClick={aplicar}>Aplicar</Button>
          <DrawerClose asChild>
            <Button variant="outline">Cancelar</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
