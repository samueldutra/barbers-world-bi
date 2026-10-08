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
import { Label } from '@/components/ui/label'
import { FiltroCanais } from '@/components/filtros/filtro-canais'
import { FiltroSituacoes } from '@/components/filtros/filtro-situacoes'
import { CanalLogo } from '@/components/filtros/canal-logo'
import type { AbaCanal } from '@/lib/abas-canais'
import type { CanalVenda } from '@/hooks/use-canais-venda'
import type { SituacaoPedido } from '@/hooks/use-situacoes-pedido'

interface Props {
  canais: CanalVenda[]
  canaisSelecionados: number[] | null
  onCanaisChange: (ids: number[] | null) => void
  situacoes: SituacaoPedido[]
  situacoesSelecionadas: number[] | null
  onSituacoesChange: (ids: number[] | null) => void
  /** Aba de canal ativa: o filtro de canais fica bloqueado (vale o canal da aba). */
  abaDeCanal?: AbaCanal | null
}

/** Botão "Filtrar" (com a quantidade de filtros aplicados) que abre um drawer com Canais e
 * Situação. As escolhas ficam num rascunho: só viram filtro de verdade em "Aplicar"; voltar,
 * "Cancelar", Esc ou clicar fora descartam. */
export function FiltrosDrawer({
  canais,
  canaisSelecionados,
  onCanaisChange,
  situacoes,
  situacoesSelecionadas,
  onSituacoesChange,
  abaDeCanal = null,
}: Props) {
  const [aberto, setAberto] = useState(false)
  const [rascunhoCanais, setRascunhoCanais] = useState<number[] | null>(null)
  const [rascunhoSituacoes, setRascunhoSituacoes] = useState<number[] | null>(null)

  // Filtros aplicados = grupos fora do padrão (canais restritos, situações diferentes do padrão).
  // Com aba de canal ativa o filtro de canais não conta (é definido pela aba).
  const aplicados =
    (!abaDeCanal && canaisSelecionados && canaisSelecionados.length > 0 ? 1 : 0) + (situacoesSelecionadas ? 1 : 0)

  const aoMudarAberto = (abrir: boolean) => {
    if (abrir) {
      // Abre sempre a partir do que está aplicado (descarta rascunhos anteriores).
      setRascunhoCanais(canaisSelecionados)
      setRascunhoSituacoes(situacoesSelecionadas)
    }
    setAberto(abrir)
  }

  const aplicar = () => {
    onCanaisChange(rascunhoCanais)
    onSituacoesChange(rascunhoSituacoes)
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
            <DrawerDescription>Escolha e clique em Aplicar para atualizar o painel.</DrawerDescription>
          </div>
        </DrawerHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
          <div className="flex flex-col gap-2">
            <Label>Canais</Label>
            {abaDeCanal ? (
              <>
                <Button variant="outline" size="sm" disabled className="w-full justify-start font-normal">
                  <CanalLogo grupo={abaDeCanal.grupo} />
                  {abaDeCanal.label}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Definido pela aba {abaDeCanal.label}. Volte para a aba Geral para filtrar por canal.
                </p>
              </>
            ) : (
              <FiltroCanais
                canais={canais}
                canaisSelecionados={rascunhoCanais}
                onCanaisChange={setRascunhoCanais}
                className="w-full"
              />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label>Situação</Label>
            <FiltroSituacoes
              situacoes={situacoes}
              situacoesSelecionadas={rascunhoSituacoes}
              onSituacoesChange={setRascunhoSituacoes}
              className="w-full"
            />
          </div>
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
