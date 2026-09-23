'use client'

import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Copy, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface AcessoGerado {
  nome: string
  email: string
  emailEnviado: boolean
  /** Motivo de o email não ter saído (limite do Supabase, SMTP...). */
  erroEmail?: string | null
  link: string | null
}

interface Props {
  acesso: AcessoGerado | null
  onOpenChange: (open: boolean) => void
}

/** Resultado de criar um usuário ou gerar um novo acesso: confirma o email enviado ou mostra
 * o link pra mandar por outro canal (o envio de email do Supabase tem limite baixo). */
export function LinkAcessoDialog({ acesso, onOpenChange }: Props) {
  const mensagemWhatsApp = acesso?.link
    ? `Olá, ${acesso.nome.split(' ')[0]}! Seu acesso ao Barbers World BI está pronto. Abra este link para criar sua senha: ${acesso.link}`
    : ''

  const copiar = async () => {
    if (!acesso?.link) return
    try {
      await navigator.clipboard.writeText(acesso.link)
      toast.success('Link copiado!')
    } catch {
      toast.error('Não foi possível copiar — selecione o link e copie manualmente.')
    }
  }

  return (
    <Dialog open={!!acesso} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{acesso?.link ? 'Link de acesso' : 'Email enviado'}</DialogTitle>
          <DialogDescription>
            {acesso?.nome} · {acesso?.email}
          </DialogDescription>
        </DialogHeader>

        {acesso?.emailEnviado && !acesso.link && (
          <div className="flex items-start gap-2 rounded-md border border-green-600/30 bg-green-600/5 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
            <p>
              Enviamos um email para a pessoa criar a senha. Se não chegar em alguns minutos (confira o spam), gere um link
              de acesso pelo menu do usuário e envie por WhatsApp.
            </p>
          </div>
        )}

        {acesso?.link && (
          <div className="flex flex-col gap-3">
            {acesso.erroEmail && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p>{acesso.erroEmail}</p>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Envie este link para a pessoa. Ao abrir, ela cria a própria senha — funciona em qualquer aparelho. O link vale
              por tempo limitado e só pode ser usado uma vez; se expirar, gere outro.
            </p>
            <Input readOnly value={acesso.link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={copiar}>
                <Copy className="h-4 w-4" />
                Copiar link
              </Button>
              <Button asChild>
                <a href={`https://wa.me/?text=${encodeURIComponent(mensagemWhatsApp)}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </a>
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
