'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { logoDoCanal, CLASSE_LOGO_CANAL } from '@/lib/canais'
import type { ConfigNuvemshop } from '@/hooks/use-canais-integracoes'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: ConfigNuvemshop | null
  onCadastrar: (nome: string) => Promise<string>
}

const PLATAFORMAS = [
  { id: 'nuvemshop', nome: 'Nuvemshop', grupo: 'Nuvemshop', disponivel: true },
  { id: 'mercado-livre', nome: 'Mercado Livre', grupo: 'Mercado Livre', disponivel: false },
  { id: 'shopee', nome: 'Shopee', grupo: 'Shopee', disponivel: false },
  { id: 'tiktok', nome: 'TikTok Shop', grupo: 'TikTok', disponivel: false },
] as const

/** Passo 1: escolher a plataforma. Passo 2 (Nuvemshop): o que é preciso + nome do canal + conectar. */
export function CadastrarCanalDialog({ open, onOpenChange, config, onCadastrar }: Props) {
  const [plataforma, setPlataforma] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [enviando, setEnviando] = useState(false)

  const fechar = (aberto: boolean) => {
    if (!aberto) {
      setPlataforma(null)
      setNome('')
    }
    onOpenChange(aberto)
  }

  const faltando = config?.faltando ?? []
  const pronto = config !== null && faltando.length === 0

  const conectar = async () => {
    setEnviando(true)
    try {
      const url = await onCadastrar(nome.trim())
      window.location.href = url // vai pra Nuvemshop autorizar; volta em /api/canais-venda/nuvemshop/callback
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível cadastrar o canal.')
      setEnviando(false)
    }
  }

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success('Copiado.')
    } catch {
      toast.error('Não foi possível copiar.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastrar canal</DialogTitle>
          <DialogDescription>
            {plataforma ? 'Conecte a loja autorizando o app da Barbers World na Nuvemshop.' : 'Escolha a plataforma do canal.'}
          </DialogDescription>
        </DialogHeader>

        {!plataforma ? (
          <div className="grid grid-cols-2 gap-3">
            {PLATAFORMAS.map((p) => {
              const logo = logoDoCanal(p.grupo)
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={!p.disponivel}
                  onClick={() => setPlataforma(p.id)}
                  className="flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {logo && <img src={logo} alt="" className={`size-8 ${CLASSE_LOGO_CANAL}`} />}
                  <span className="font-medium">{p.nome}</span>
                  {!p.disponivel && <span className="text-xs text-muted-foreground">Em breve</span>}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium">O que é preciso para integrar</p>
              <ul className="flex flex-col gap-2">
                <Requisito ok={config !== null && !faltando.includes('NUVEMSHOP_APP_ID') && !faltando.includes('NUVEMSHOP_CLIENT_SECRET')}>
                  App da Barbers World criado na Nuvemshop (<code>NUVEMSHOP_APP_ID</code> e{' '}
                  <code>NUVEMSHOP_CLIENT_SECRET</code> no servidor)
                </Requisito>
                <Requisito ok={config !== null && !faltando.includes('NEXT_PUBLIC_APP_URL')}>
                  URL pública do BI (<code>NEXT_PUBLIC_APP_URL</code>) para a URL de retorno
                </Requisito>
                <Requisito ok={null}>
                  Acesso de <strong>administrador</strong> à loja Nuvemshop que será conectada (você vai entrar nela e
                  clicar em “Aceitar”)
                </Requisito>
              </ul>
              {config?.redirectUri && (
                <div className="mt-1 flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">URL de retorno (cadastre igual no app)</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={config.redirectUri} className="font-mono text-xs" />
                    <Button type="button" variant="outline" size="icon" onClick={() => copiar(config.redirectUri!)}>
                      <Copy className="size-4" />
                    </Button>
                  </div>
                </div>
              )}
              {!pronto && config && (
                <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Falta configurar no servidor (Vercel → Environment Variables): <code>{faltando.join(', ')}</code>.
                    Passo a passo em <code>dashboard/docs/integracao-nuvemshop.md</code>.
                  </span>
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nome-canal">Nome do canal</Label>
              <Input
                id="nome-canal"
                placeholder="Ex.: Nuvemshop — Loja Barbers World"
                value={nome}
                maxLength={80}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {plataforma && (
            <Button variant="ghost" onClick={() => setPlataforma(null)} disabled={enviando}>
              Voltar
            </Button>
          )}
          {plataforma && (
            <Button onClick={conectar} disabled={!pronto || nome.trim().length < 2 || enviando}>
              {enviando ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
              Conectar com a Nuvemshop
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Requisito({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok === true ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      ) : ok === false ? (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
      ) : (
        <span className="mt-1.5 ml-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
      )}
      <span>{children}</span>
    </li>
  )
}
