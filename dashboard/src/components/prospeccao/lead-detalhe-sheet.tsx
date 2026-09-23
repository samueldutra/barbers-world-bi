'use client'

import { useState } from 'react'
import { ExternalLink, Navigation, Phone, SkipForward, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from 'cn'
import { useIsMobile } from '@/hooks/use-mobile'
import { montarUrlNavegacao } from '@/lib/google-maps-route'
import type { LeadMapeado, StatusLead } from '@/hooks/use-leads-mapeados'

const OPCOES: { status: StatusLead; label: string; classe: string }[] = [
  { status: 'lead', label: 'Lead', classe: 'data-[ativo=true]:bg-amber-500 data-[ativo=true]:text-white data-[ativo=true]:border-amber-500' },
  { status: 'cliente', label: 'Cliente', classe: 'data-[ativo=true]:bg-primary data-[ativo=true]:text-primary-foreground data-[ativo=true]:border-primary' },
  { status: 'concorrente', label: 'Concorrente', classe: 'data-[ativo=true]:bg-stone-500 data-[ativo=true]:text-white data-[ativo=true]:border-stone-500' },
]

const LABEL_STATUS: Record<StatusLead, string> = {
  cliente: 'Cliente',
  concorrente: 'Concorrente',
  lead: 'Lead',
  pendente: 'A classificar',
}

/** Ficha do estabelecimento no Google Maps (fotos, horário, avaliações) — pelo place_id
 * quando o lead veio do Google Places, senão pela busca do nome perto do ponto. */
function urlFichaGoogle(lead: LeadMapeado): string {
  const params = new URLSearchParams({ api: '1', query: `${lead.nome} ${lead.endereco ?? ''}`.trim() })
  if (lead.origem_tipo === 'google' && lead.origem_id) params.set('query_place_id', lead.origem_id)
  return `https://www.google.com/maps/search/?${params.toString()}`
}

interface Props {
  lead: LeadMapeado | null
  onOpenChange: (aberto: boolean) => void
  onClassificar: (lead: LeadMapeado, status: StatusLead) => void
  onExcluir: (lead: LeadMapeado) => void
  /** Leads ainda "A classificar" além deste — alimenta o modo triagem. */
  pendentesRestantes: number
  onPular: () => void
}

/** Detalhe/classificação de um lead. No celular vem de baixo (alcance do polegar) e, ao
 * classificar um lead pendente, a página já abre o próximo — triagem em sequência. */
export function LeadDetalheSheet({ lead, onOpenChange, onClassificar, onExcluir, pendentesRestantes, onPular }: Props) {
  const isMobile = useIsMobile()
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const telefone = lead?.telefone?.replace(/[^\d+]/g, '')

  return (
    <Sheet
      open={!!lead}
      onOpenChange={(v) => {
        if (!v) setConfirmandoExclusao(false)
        onOpenChange(v)
      }}
    >
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={cn(isMobile && 'max-h-[85vh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]')}
      >
        {lead && (
          // key: ao avançar pro próximo lead, reinicia a animação e o estado de confirmação.
          <div key={lead.id} className="flex flex-col gap-4 overflow-y-auto animate-in fade-in-0 slide-in-from-right-2 duration-200">
            {isMobile && <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-muted" aria-hidden />}
            <SheetHeader className="pb-0">
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <Badge variant="outline">{LABEL_STATUS[lead.status]}</Badge>
                {lead.cidade && <Badge variant="outline">{lead.cidade}</Badge>}
                {pendentesRestantes > 0 && (
                  <span className="text-xs text-muted-foreground">{pendentesRestantes} a classificar depois deste</span>
                )}
              </div>
              <SheetTitle className="text-lg leading-snug">{lead.nome}</SheetTitle>
              <SheetDescription>{lead.endereco || 'Sem endereço'}</SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-2 px-4">
              <p className="text-xs font-medium text-muted-foreground">Classificar como</p>
              <div className="grid grid-cols-3 gap-2">
                {OPCOES.map((op) => (
                  <Button
                    key={op.status}
                    variant="outline"
                    data-ativo={lead.status === op.status}
                    className={cn('h-12 text-sm font-medium transition-colors', op.classe)}
                    onClick={() => {
                      setConfirmandoExclusao(false)
                      onClassificar(lead, op.status)
                    }}
                  >
                    {op.label}
                  </Button>
                ))}
              </div>
              {lead.status === 'pendente' && pendentesRestantes > 0 && (
                <Button variant="ghost" size="sm" className="self-end text-muted-foreground" onClick={onPular}>
                  <SkipForward className="h-4 w-4" />
                  Pular
                </Button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 px-4">
              <Button variant="outline" className="h-11" asChild>
                <a href={montarUrlNavegacao(lead.latitude, lead.longitude)} target="_blank" rel="noopener noreferrer">
                  <Navigation className="h-4 w-4" />
                  Navegar
                </a>
              </Button>
              {telefone ? (
                <Button variant="outline" className="h-11" asChild>
                  <a href={`tel:${telefone}`}>
                    <Phone className="h-4 w-4" />
                    Ligar
                  </a>
                </Button>
              ) : (
                <Button variant="outline" className="h-11" disabled>
                  <Phone className="h-4 w-4" />
                  Sem tel.
                </Button>
              )}
              <Button variant="outline" className="h-11" asChild>
                <a href={urlFichaGoogle(lead)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Ver no Maps
                </a>
              </Button>
            </div>
            {telefone && <p className="-mt-2 px-4 text-xs text-muted-foreground">{lead.telefone}</p>}

            <SheetFooter className="border-t pt-3">
              {confirmandoExclusao ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm">Remover este lead do mapeamento?</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={() => setConfirmandoExclusao(false)}>
                      Cancelar
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setConfirmandoExclusao(false)
                        onExcluir(lead)
                      }}
                    >
                      Remover
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmandoExclusao(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Remover lead
                </Button>
              )}
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
