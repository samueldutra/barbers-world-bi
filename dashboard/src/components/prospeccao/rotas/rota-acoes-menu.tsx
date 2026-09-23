'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Loader2, MoreVertical, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { LABEL_STATUS_ROTA, ORDEM_STATUS_ROTA } from '@/lib/rotas'
import type { RotaVisita, StatusRota } from '@/hooks/use-rotas-visita'

interface Props {
  rota: RotaVisita
  onAlterarStatus: (status: StatusRota) => Promise<void>
  onExcluir: () => Promise<void>
  /** Na listagem, o menu também leva pra tela da rota. */
  linkAbrir?: string
  className?: string
}

export function RotaAcoesMenu({ rota, onAlterarStatus, onExcluir, linkAbrir, className }: Props) {
  const [confirmarExclusao, setConfirmarExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)

  const handleExcluir = async () => {
    setExcluindo(true)
    try {
      await onExcluir()
      setConfirmarExclusao(false)
    } finally {
      setExcluindo(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className={className} aria-label={`Ações da rota ${rota.nome}`}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {linkAbrir && (
            <>
              <DropdownMenuItem asChild>
                <Link href={linkAbrir}>
                  <ExternalLink className="h-4 w-4" />
                  Abrir rota
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuLabel className="text-xs text-muted-foreground">Status</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={rota.status} onValueChange={(v) => onAlterarStatus(v as StatusRota)}>
            {ORDEM_STATUS_ROTA.map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>
                {LABEL_STATUS_ROTA[s]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmarExclusao(true)}>
            <Trash2 className="h-4 w-4" />
            Excluir rota
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmarExclusao} onOpenChange={(v) => !excluindo && setConfirmarExclusao(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a rota &quot;{rota.nome}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              As {rota.total_paradas} parada(s) e o registro de visitas desta rota serão apagados. Os leads continuam no
              mapeamento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" onClick={handleExcluir} disabled={excluindo}>
              {excluindo && <Loader2 className="h-4 w-4 animate-spin" />}
              Excluir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
