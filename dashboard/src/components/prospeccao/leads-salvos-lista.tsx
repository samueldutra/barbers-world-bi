'use client'

import { useMemo, useState } from 'react'
import { MapPin, Route, Save, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { montarUrlRota } from '@/lib/google-maps-route'
import { ordenarPorProximidade } from '@/lib/distancia'
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
 * 'rota' (Rotas): marca leads como paradas e gera/salva a rota — status só pra consulta. */
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
  onSalvarRota?: (nome: string, descricao: string | null, leadIds: number[]) => Promise<void>
}

const SEM_SELECAO = new Set<number>()

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
  onSalvarRota,
}: Props) {
  const modoRota = modo === 'rota'
  const [filtroStatus, setFiltroStatus] = useState<StatusLead | 'todos'>('todos')
  const [dialogAberto, setDialogAberto] = useState(false)
  const [nomeRota, setNomeRota] = useState('')
  const [descricaoRota, setDescricaoRota] = useState('')
  const [ordenarPorDistancia, setOrdenarPorDistancia] = useState(true)
  const [salvandoRota, setSalvandoRota] = useState(false)

  const leadsFiltrados = useMemo(
    () => (filtroStatus === 'todos' ? leads : leads.filter((l) => l.status === filtroStatus)),
    [leads, filtroStatus]
  )

  // Ordem de seleção (não a ordem da lista) — Set preserva a ordem de inserção em JS, então
  // isso respeita a sequência em que o usuário clicou no mapa/lista, que é a ordem da rota.
  const leadsSelecionados = Array.from(selecionados)
    .map((id) => leads.find((l) => l.id === id))
    .filter((l): l is LeadMapeado => l != null)

  const handleSalvarRota = async () => {
    if (!nomeRota.trim() || !onSalvarRota) return
    setSalvandoRota(true)
    try {
      const leadsFinal = ordenarPorDistancia ? ordenarPorProximidade(centro, leadsSelecionados) : leadsSelecionados
      await onSalvarRota(nomeRota.trim(), descricaoRota.trim() || null, leadsFinal.map((l) => l.id))
      setDialogAberto(false)
      setNomeRota('')
      setDescricaoRota('')
      onLimparSelecao?.()
    } finally {
      setSalvandoRota(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>{modoRota ? 'Escolher paradas' : 'Leads mapeados'}</CardTitle>
          <CardDescription>
            {modoRota
              ? `${leads.length} leads mapeados — marque aqui ou clique no mapa pra montar a rota`
              : `${leads.length} salvos no total — classifique como cliente, concorrente ou lead`}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filtroStatus} onValueChange={(v) => setFiltroStatus(v as StatusLead | 'todos')}>
            <SelectTrigger className="w-40" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="pendente">A classificar</SelectItem>
              <SelectItem value="cliente">Cliente</SelectItem>
              <SelectItem value="concorrente">Concorrente</SelectItem>
              <SelectItem value="lead">Lead</SelectItem>
            </SelectContent>
          </Select>
          {modoRota && (
            <>
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
              <Button size="sm" disabled={leadsSelecionados.length === 0} onClick={() => setDialogAberto(true)}>
                <Save className="h-4 w-4" />
                Salvar rota
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
        ) : leadsFiltrados.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum lead {filtroStatus !== 'todos' ? `com status "${LABEL_STATUS[filtroStatus]}"` : 'salvo ainda'}.
            {modoRota
              ? 'Mapeie leads no Mapeamento de Leads pra montar rotas com eles.'
              : 'Busque no mapa acima — os resultados são salvos automaticamente pra você classificar.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {leadsFiltrados.map((lead) => (
              <li key={lead.id} className="flex items-center gap-3 py-3">
                {modoRota && (
                  <Checkbox checked={selecionados.has(lead.id)} onCheckedChange={() => onToggleSelecionado?.(lead.id)} />
                )}
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{lead.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[lead.endereco, lead.telefone].filter(Boolean).join(' · ') || 'Sem endereço/telefone'}
                  </p>
                </div>
                {lead.cidade && (
                  <Badge variant="outline" className="shrink-0">
                    {lead.cidade}
                  </Badge>
                )}
                <Badge
                  variant={VARIANTE_STATUS[lead.status]}
                  className={lead.status === 'pendente' ? CLASSE_BADGE_PENDENTE : undefined}
                >
                  {LABEL_STATUS[lead.status]}
                </Badge>
                {!modoRota && (
                  <>
                    <Select value={lead.status} onValueChange={(v) => onAtualizarStatus?.(lead.id, v as StatusLead)}>
                      <SelectTrigger className="w-32" size="sm">
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
                      className="text-destructive hover:text-destructive"
                      onClick={() => onExcluir?.(lead.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salvar rota de visita</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{leadsSelecionados.length} parada(s) selecionada(s).</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nome-rota">Nome</Label>
              <Input
                id="nome-rota"
                placeholder="ex.: Rota zona norte — semana 1"
                value={nomeRota}
                onChange={(e) => setNomeRota(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="descricao-rota">Descrição (opcional)</Label>
              <Textarea
                id="descricao-rota"
                placeholder="Observações sobre essa rota..."
                value={descricaoRota}
                onChange={(e) => setDescricaoRota(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="ordenar-distancia"
                checked={ordenarPorDistancia}
                onCheckedChange={(v) => setOrdenarPorDistancia(v === true)}
              />
              <Label htmlFor="ordenar-distancia" className="text-sm font-normal">
                Ordenar pela distância entre os pontos (rota mais eficiente)
              </Label>
            </div>
            {!ordenarPorDistancia && (
              <p className="text-xs text-muted-foreground">
                Desmarcado: mantém a ordem em que os pontos foram selecionados no mapa/lista.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogAberto(false)} disabled={salvandoRota}>
              Cancelar
            </Button>
            <Button onClick={handleSalvarRota} disabled={!nomeRota.trim() || salvandoRota}>
              {salvandoRota ? 'Salvando...' : 'Salvar rota'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
