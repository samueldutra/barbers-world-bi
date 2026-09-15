'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Trash2 } from 'lucide-react'
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
import { moduleLabel } from '@/types/modules'
import type { Usuario } from '@/hooks/use-usuarios'

interface Props {
  usuarios: Usuario[]
  loading: boolean
  usuarioAtualId: string | undefined
  onEditar: (usuario: Usuario) => void
  onExcluir: (id: string) => Promise<void>
}

export function UsuariosLista({ usuarios, loading, usuarioAtualId, onEditar, onExcluir }: Props) {
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
            <TableHead>Email</TableHead>
            <TableHead>Acesso</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usuarios.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">
                {u.full_name || '—'}
                {u.id === usuarioAtualId && <span className="ml-2 text-xs text-muted-foreground">(você)</span>}
              </TableCell>
              <TableCell className="text-muted-foreground">{u.email}</TableCell>
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
                <Badge variant={u.is_active ? 'secondary' : 'destructive'}>
                  {u.is_active ? 'Ativo' : 'Inativo'}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button size="icon" variant="ghost" onClick={() => onEditar(u)}>
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
