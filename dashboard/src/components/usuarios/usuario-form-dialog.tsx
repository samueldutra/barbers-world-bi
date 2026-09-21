'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SYSTEM_MODULES } from '@/types/modules'
import { createClient } from '@/lib/supabase/client'
import type { Usuario, CriarUsuarioInput, AtualizarUsuarioInput } from '@/hooks/use-usuarios'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  usuario: Usuario | null
  onCriar: (input: CriarUsuarioInput) => Promise<{ id: string; email: string }>
  onAtualizar: (id: string, input: AtualizarUsuarioInput) => Promise<void>
}

export function UsuarioFormDialog({ open, onOpenChange, usuario, onCriar, onAtualizar }: Props) {
  const editando = usuario !== null

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [modules, setModules] = useState<Set<string>>(new Set())
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!open) return
    setFullName(usuario?.full_name ?? '')
    setEmail(usuario?.email ?? '')
    setIsSuperAdmin(usuario?.is_superadmin ?? false)
    setIsActive(usuario?.is_active ?? true)
    setModules(new Set(usuario?.modules ?? []))
  }, [open, usuario])

  const toggleModulo = (id: string) => {
    setModules((atual) => {
      const novo = new Set(atual)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  const handleSalvar = async () => {
    if (!fullName.trim()) {
      toast.error('Informe o nome completo.')
      return
    }
    if (!editando && !email.trim()) {
      toast.error('Informe o email.')
      return
    }
    if (!isSuperAdmin && modules.size === 0) {
      toast.error('Selecione ao menos um módulo (ou marque como super admin).')
      return
    }

    setSalvando(true)
    try {
      if (editando) {
        await onAtualizar(usuario!.id, {
          full_name: fullName.trim(),
          is_superadmin: isSuperAdmin,
          is_active: isActive,
          modules: Array.from(modules),
        })
        toast.success('Usuário atualizado.')
      } else {
        const criado = await onCriar({
          email: email.trim().toLowerCase(),
          full_name: fullName.trim(),
          is_superadmin: isSuperAdmin,
          modules: Array.from(modules),
        })

        // Dispara o email de "definir senha" — mesmo fluxo de "Esqueci minha senha".
        const supabase = createClient()
        const { error } = await supabase.auth.resetPasswordForEmail(criado.email, {
          redirectTo: `${window.location.origin}/api/auth/recovery`,
        })
        if (error) {
          toast.warning('Usuário criado, mas não consegui enviar o email de acesso. Peça pra ele usar "Esqueci minha senha" no login.')
        } else {
          toast.success('Usuário criado! Enviamos um email pra ele definir a senha.')
        }
      }
      onOpenChange(false)
    } catch (err) {
      console.error('Erro ao salvar usuário:', err)
      toast.error(err instanceof Error ? err.message : 'Não foi possível salvar o usuário.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
          <DialogDescription>
            {editando
              ? 'Ajuste o acesso desse usuário aos módulos do sistema.'
              : 'A pessoa recebe um email pra definir a própria senha — não precisa te passar credencial nenhuma.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="full-name">Nome completo</Label>
            <Input
              id="full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={salvando}
              placeholder="Ex.: Maria Silva"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={salvando || editando}
              placeholder="pessoa@exemplo.com"
            />
            {editando && <p className="text-xs text-muted-foreground">Email não pode ser alterado por aqui.</p>}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="is-superadmin"
              checked={isSuperAdmin}
              onCheckedChange={(v) => setIsSuperAdmin(v === true)}
              disabled={salvando}
            />
            <Label htmlFor="is-superadmin" className="font-normal">
              Super admin — acesso total a todos os módulos
            </Label>
          </div>

          {editando && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="is-active"
                checked={isActive}
                onCheckedChange={(v) => setIsActive(v === true)}
                disabled={salvando}
              />
              <Label htmlFor="is-active" className="font-normal">
                Conta ativa (desmarcar desativa o login)
              </Label>
            </div>
          )}

          {!isSuperAdmin && (
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <p className="text-sm font-medium">Módulos liberados</p>
              {SYSTEM_MODULES.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`modulo-${m.id}`}
                    checked={modules.has(m.id)}
                    onCheckedChange={() => toggleModulo(m.id)}
                    disabled={salvando}
                  />
                  <Label htmlFor={`modulo-${m.id}`} className="font-normal">
                    {m.label}
                  </Label>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={handleSalvar} disabled={salvando}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {editando ? 'Salvar' : 'Criar usuário'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
