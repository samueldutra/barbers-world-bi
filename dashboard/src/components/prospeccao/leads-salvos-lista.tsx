'use client'

import { useMemo, useState } from 'react'
import { MapPin, Route, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { LeadMapeado, StatusLead } from '@/hooks/use-leads-mapeados'

const LABEL_STATUS: Record<StatusLead, string> = {
  cliente: 'Cliente',
  concorrente: 'Concorrente',
  lead: 'Lead',
}

const VARIANTE_STATUS: Record<StatusLead, 'default' | 'secondary' | 'outline'> = {
  cliente: 'default',
  lead: 'secondary',
  concorrente: 'outline',
}

interface Props {
  leads: LeadMapeado[]
  loading: boolean
  centro: { lat: number; lon: number }
  onAtualizarStatus: (id: number, status: StatusLead) => void
  onExcluir: (id: number) => void
}

/** Monta um link do Google Maps com paradas nos leads selecionados — não precisa de
 * nenhuma API paga, o próprio Google Maps calcula a rota ao abrir o link. */
function montarUrlRota(centro: { lat: number; lon: number }, selecionados: LeadMapeado[]): string {
  const origem = `${centro.lat},${centro.lon}`
  const destino = `${selecionados[selecionados.length - 1].latitude},${selecionados[selecionados.length - 1].longitude}`
  const paradas = selecionados
    .slice(0, -1)
    .map((l) => `${l.latitude},${l.longitude}`)
    .join('|')
  const params = new URLSearchParams({ api: '1', origin: origem, destination: destino, travelmode: 'driving' })
  if (paradas) params.set('waypoints', paradas)
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

export function LeadsSalvosLista({ leads, loading, centro, onAtualizarStatus, onExcluir }: Props) {
  const [filtroStatus, setFiltroStatus] = useState<StatusLead | 'todos'>('todos')
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())

  const leadsFiltrados = useMemo(
    () => (filtroStatus === 'todos' ? leads : leads.filter((l) => l.status === filtroStatus)),
    [leads, filtroStatus]
  )

  const toggleSelecionado = (id: number) => {
    setSelecionados((atual) => {
      const novo = new Set(atual)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  const leadsSelecionados = leads.filter((l) => selecionados.has(l.id))

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Leads mapeados</CardTitle>
          <CardDescription>{leads.length} salvos no total — marque pra gerar rota de visita</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filtroStatus} onValueChange={(v) => setFiltroStatus(v as StatusLead | 'todos')}>
            <SelectTrigger className="w-40" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="cliente">Cliente</SelectItem>
              <SelectItem value="concorrente">Concorrente</SelectItem>
              <SelectItem value="lead">Lead</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={leadsSelecionados.length === 0}
            onClick={() => window.open(montarUrlRota(centro, leadsSelecionados), '_blank')}
          >
            <Route className="h-4 w-4" />
            Gerar rota ({leadsSelecionados.length})
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
        ) : leadsFiltrados.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum lead {filtroStatus !== 'todos' ? `com status "${LABEL_STATUS[filtroStatus]}"` : 'salvo ainda'}.
            Busque no mapa acima e salve os resultados.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {leadsFiltrados.map((lead) => (
              <li key={lead.id} className="flex items-center gap-3 py-3">
                <Checkbox checked={selecionados.has(lead.id)} onCheckedChange={() => toggleSelecionado(lead.id)} />
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{lead.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[lead.endereco, lead.telefone].filter(Boolean).join(' · ') || 'Sem endereço/telefone'}
                  </p>
                </div>
                <Select value={lead.status} onValueChange={(v) => onAtualizarStatus(lead.id, v as StatusLead)}>
                  <SelectTrigger className="w-36" size="sm">
                    <Badge variant={VARIANTE_STATUS[lead.status]} className="pointer-events-none">
                      {LABEL_STATUS[lead.status]}
                    </Badge>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cliente">Cliente</SelectItem>
                    <SelectItem value="concorrente">Concorrente</SelectItem>
                    <SelectItem value="lead">Lead</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onExcluir(lead.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
