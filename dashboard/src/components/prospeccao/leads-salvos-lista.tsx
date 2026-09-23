'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, MapPin, Route, Save, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from 'cn'
import { montarUrlRota } from '@/lib/google-maps-route'
import type { LeadMapeado, StatusLead } from '@/hooks/use-leads-mapeados'

const LABEL_STATUS: Record<StatusLead, string> = {
  cliente: 'Cliente',
  concorrente: 'Concorrente',
  lead: 'Lead',
  pendente: 'A classificar',
}

const VARIANTE_STATUS: Record<StatusLead, 'default' | 'secondary' | 'outline'> = {
  cliente: 'default',
  lead: 'secondary',
  concorrente: 'outline',
  pendente: 'outline',
}

const CLASSE_BADGE_PENDENTE = 'border-sky-400 text-sky-600 dark:border-sky-500 dark:text-sky-400'

/** 'classificar' (Mapeamento): muda status e remove leads.
 * 'rota' (Montar rota): marca leads como paradas — status só pra consulta. */
type Modo = 'classificar' | 'rota'

interface Props {
  modo: Modo
  leads: LeadMapeado[]
  loading: boolean
  centro: { lat: number; lon: number }
  onAtualizarStatus?: (id: number, status: StatusLead) => void
  onExcluir?: (id: number) => void
  selecionados?: Set<number>
  onToggleSelecionado?: (id: number) => void
  onLimparSelecao?: () => void
  onAbrirSalvarRota?: () => void
  /** Classificar: tocar no lead abre o detalhe (no celular substitui o select/lixeira). */
  onAbrirLead?: (lead: LeadMapeado) => void
  /** Filtro de status controlado de fora (ex.: atalho "A classificar" da página). */
  filtroStatus?: StatusLead | 'todos'
  onFiltroStatusChange?: (v: StatusLead | 'todos') => void
}

const SEM_SELECAO = new Set<number>()

function Selos({ lead, className }: { lead: LeadMapeado; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {lead.cidade && (
        <Badge variant="outline" className="max-w-40 truncate">
          {lead.cidade}
        </Badge>
      )}
      <Badge
        variant={VARIANTE_STATUS[lead.status]}
        className={lead.status === 'pendente' ? CLASSE_BADGE_PENDENTE : undefined}
      >
        {LABEL_STATUS[lead.status]}
      </Badge>
    </div>
  )
}

function InfoLead({ lead }: { lead: LeadMapeado }) {
  return (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{lead.nome}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[lead.endereco, lead.telefone].filter(Boolean).join(' · ') || 'Sem endereço/telefone'}
        </p>
        {/* No celular os selos descem pra baixo do nome em vez de espremer a linha. */}
        <Selos lead={lead} className="mt-1.5 sm:hidden" />
      </div>
      <Selos lead={lead} className="hidden shrink-0 sm:flex" />
    </>
  )
}

export function LeadsSalvosLista({
  modo,
  leads,
  loading,
  centro,
  selecionados = SEM_SELECAO,
  onToggleSelecionado,
  onLimparSelecao,
  onAtualizarStatus,
  onExcluir,
  onAbrirSalvarRota,
  onAbrirLead,
  filtroStatus: filtroControlado,
  onFiltroStatusChange,
}: Props) {
  const modoRota = modo === 'rota'
  const [filtroInterno, setFiltroInterno] = useState<StatusLead | 'todos'>('todos')
  const filtroStatus = filtroControlado ?? filtroInterno
  const setFiltroStatus = onFiltroStatusChange ?? setFiltroInterno

  const leadsFiltrados = useMemo(
    () => (filtroStatus === 'todos' ? leads : leads.filter((l) => l.status === filtroStatus)),
    [leads, filtroStatus]
  )

  // Ordem de seleção (não a ordem da lista) — Set preserva a ordem de inserção em JS, então
  // isso respeita a sequência em que o usuário clicou no mapa/lista, que é a ordem da rota.
  const ordemSelecao = useMemo(() => new Map(Array.from(selecionados).map((id, i) => [id, i + 1])), [selecionados])
  const leadsSelecionados = Array.from(selecionados)
    .map((id) => leads.find((l) => l.id === id))
    .filter((l): l is LeadMapeado => l != null)

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>{modoRota ? 'Escolher paradas' : 'Leads mapeados'}</CardTitle>
          <CardDescription>
            {modoRota
              ? `${leads.length} leads mapeados — toque aqui ou no mapa, na ordem da visita`
              : `${leads.length} salvos no total — classifique como cliente, concorrente ou lead`}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filtroStatus} onValueChange={(v) => setFiltroStatus(v as StatusLead | 'todos')}>
            <SelectTrigger className="w-full sm:w-40" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              <SelectItem value="pendente">A classificar</SelectItem>
              <SelectItem value="cliente">Cliente</SelectItem>
              <SelectItem value="concorrente">Concorrente</SelectItem>
              <SelectItem value="lead">Lead</SelectItem>
            </SelectContent>
          </Select>
          {/* No celular essas ações ficam na barra fixa da página. */}
          {modoRota && (
            <div className="hidden items-center gap-2 sm:flex">
              {selecionados.size > 0 && (
                <Button size="sm" variant="ghost" onClick={onLimparSelecao}>
                  Limpar seleção
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={leadsSelecionados.length === 0}
                onClick={() => window.open(montarUrlRota(centro, leadsSelecionados), '_blank')}
              >
                <Route className="h-4 w-4" />
                Gerar rota ({leadsSelecionados.length})
              </Button>
              <Button size="sm" disabled={leadsSelecionados.length === 0} onClick={onAbrirSalvarRota}>
                <Save className="h-4 w-4" />
                Salvar rota
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
        ) : leadsFiltrados.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum lead {filtroStatus !== 'todos' ? `com status "${LABEL_STATUS[filtroStatus]}"` : 'salvo ainda'}.{' '}
            {modoRota
              ? 'Mapeie leads no Mapeamento de Leads pra montar rotas com eles.'
              : 'Busque no mapa acima — os resultados são salvos automaticamente pra você classificar.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {leadsFiltrados.map((lead) => {
              if (modoRota) {
                const posicao = ordemSelecao.get(lead.id)
                // A linha inteira é o alvo de toque (mais fácil no celular que um checkbox).
                return (
                  <li key={lead.id}>
                    <button
                      type="button"
                      onClick={() => onToggleSelecionado?.(lead.id)}
                      aria-pressed={!!posicao}
                      className={cn(
                        '-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-muted/50',
                        posicao && 'bg-primary/5'
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                          posicao ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                        )}
                      >
                        {posicao ?? ''}
                      </span>
                      <InfoLead lead={lead} />
                    </button>
                  </li>
                )
              }

              return (
                <li key={lead.id} className="flex items-center gap-3 py-1 sm:py-2">
                  {onAbrirLead ? (
                    <button
                      type="button"
                      onClick={() => onAbrirLead(lead)}
                      className="-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/50 active:bg-muted"
                    >
                      <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <InfoLead lead={lead} />
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground sm:hidden" />
                    </button>
                  ) : (
                    <>
                      <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <InfoLead lead={lead} />
                    </>
                  )}
                  <Select value={lead.status} onValueChange={(v) => onAtualizarStatus?.(lead.id, v as StatusLead)}>
                    <SelectTrigger
                      className={cn('w-32 shrink-0', onAbrirLead && 'hidden sm:flex')}
                      size="sm"
                      aria-label="Status"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pendente">A classificar</SelectItem>
                      <SelectItem value="cliente">Cliente</SelectItem>
                      <SelectItem value="concorrente">Concorrente</SelectItem>
                      <SelectItem value="lead">Lead</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn('shrink-0 text-destructive hover:text-destructive', onAbrirLead && 'hidden sm:inline-flex')}
                    onClick={() => onExcluir?.(lead.id)}
                    aria-label={`Remover ${lead.nome}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
