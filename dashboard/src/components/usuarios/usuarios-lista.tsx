'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { KeyRound, Link2, Loader2, Mail, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { moduleLabel } from '@/types/modules'
import { formatarDataHora } from '@/lib/formatters'
import type { Usuario } from '@/hooks/use-usuarios'

interface Props {
  usuarios: Usuario[]
  loading: boolean
  usuarioAtualId: string | undefined
  onEditar: (usuario: Usuario) => void
  onExcluir: (id: string) => Promise<void>
  /** Novo acesso: link pra copiar/WhatsApp (enviarEmail=false) ou email do Supabase. */
  onGerarAcesso: (usuario: Usuario, enviarEmail: boolean) => Promise<void>
}

export function UsuariosLista({ usuarios, loading, usuarioAtualId, onEditar, onExcluir, onGerarAcesso }: Props) {
  const [gerandoId, setGerandoId] = useState<string | null>(null)

  const handleGerarAcesso = async (u: Usuario, enviarEmail: boolean) => {
    setGerandoId(u.id)
    try {
      await onGerarAcesso(u, enviarEmail)
    } finally {
      setGerandoId(null)
    }
  }

  const [excluindoId, setExcluindoId] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)

  const usuarioParaExcluir = usuarios.find((u) => u.id === excluindoId) ?? null

  const handleConfirmarExclusao = async () => {
    if (!excluindoId) return
    setConfirmando(true)
    try {
      await onExcluir(excluindoId)
      toast.success('Usuário excluído.')
      setExcluindoId(null)
    } catch (err) {
      console.error('Erro ao excluir usuário:', err)
      toast.error(err instanceof Error ? err.message : 'Não foi possível excluir esse usuário.')
    } finally {
      setConfirmando(false)
    }
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
  }

  if (usuarios.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum usuário cadastrado ainda.</p>
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead className="hidden md:table-cell">Email</TableHead>
            <TableHead>Módulos</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usuarios.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">
                {u.full_name || '—'}
                {u.id === usuarioAtualId && <span className="ml-2 text-xs text-muted-foreground">(você)</span>}
                <p className="text-xs font-normal text-muted-foreground md:hidden">{u.email}</p>
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">{u.email}</TableCell>
              <TableCell>
                {u.is_superadmin ? (
                  <Badge>Super admin</Badge>
                ) : u.modules.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Nenhum módulo</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {u.modules.map((m) => (
                      <Badge key={m} variant="outline" className="text-xs">
                        {moduleLabel(m)}
                      </Badge>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-1">
                  {!u.is_active ? (
                    <Badge variant="destructive">Inativo</Badge>
                  ) : u.convite_pendente ? (
                    <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400">
                      Aguardando 1º acesso
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Ativo</Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {u.ultimo_acesso ? `Último acesso ${formatarDataHora(u.ultimo_acesso)}` : 'Nunca acessou'}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" disabled={gerandoId === u.id} aria-label={`Acesso de ${u.full_name || u.email}`}>
                        {gerandoId === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-60">
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        {u.convite_pendente ? 'Novo convite' : 'Redefinir senha'}
                      </DropdownMenuLabel>
                      <DropdownMenuItem onSelect={() => handleGerarAcesso(u, false)}>
                        <Link2 className="h-4 w-4" />
                        Gerar link (WhatsApp)
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleGerarAcesso(u, true)}>
                        <Mail className="h-4 w-4" />
                        Enviar por email
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button size="icon" variant="ghost" onClick={() => onEditar(u)} aria-label="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={u.id === usuarioAtualId}
                    onClick={() => setExcluindoId(u.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog open={excluindoId !== null} onOpenChange={(open) => !open && setExcluindoId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que quer excluir {usuarioParaExcluir?.full_name || usuarioParaExcluir?.email}? Essa ação não
              pode ser desfeita — a pessoa perde o acesso imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmarExclusao} disabled={confirmando}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
