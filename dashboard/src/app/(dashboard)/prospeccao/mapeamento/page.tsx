'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { ChevronDown, List, Loader2, Map as MapIcon, MapPinPlus, Search, Sparkles, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LeadsSalvosLista } from '@/components/prospeccao/leads-salvos-lista'
import { LeadDetalheSheet } from '@/components/prospeccao/lead-detalhe-sheet'
import { PontoPartidaCampo } from '@/components/prospeccao/ponto-partida-campo'
import { useBuscaNicho, type ResultadoBusca, type PontoBusca } from '@/hooks/use-busca-nicho'
import { useLeadsMapeados, type LeadMapeado, type StatusLead } from '@/hooks/use-leads-mapeados'
import { usePontoPartida } from '@/hooks/use-ponto-partida'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from 'cn'

const MapaProspeccao = dynamic(
  () => import('@/components/prospeccao/mapa-prospeccao').then((m) => m.MapaProspeccao),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> }
)

const OPCOES_RAIO = [
  { valor: 1000, label: '1 km' },
  { valor: 2000, label: '2 km' },
  { valor: 5000, label: '5 km' },
  { valor: 10000, label: '10 km' },
  { valor: 20000, label: '20 km' },
]

// O Google Places limita a 20 resultados por busca, então acima desse raio o retorno tende
// a se repetir. Pra cobrir mais área, some pontos de busca em vez de só aumentar o raio.
const MAX_PONTOS_EXTRAS = 8

const LABEL_STATUS: Record<StatusLead, string> = {
  cliente: 'cliente',
  concorrente: 'concorrente',
  lead: 'lead',
  pendente: 'a classificar',
}

/** Mapeamento de Leads: encontrar estabelecimentos por nicho no mapa e classificá-los.
 * Montar e acompanhar rotas de visita fica em /prospeccao/rotas. */
export default function MapeamentoLeadsPage() {
  const isMobile = useIsMobile()
  const [nicho, setNicho] = useState('barbearia')
  const [raioMetros, setRaioMetros] = useState(5000)
  const ponto = usePontoPartida()
  const { centro, nomeCentro } = ponto
  const [pontosExtras, setPontosExtras] = useState<PontoBusca[]>([])
  const [modoAdicionarPonto, setModoAdicionarPonto] = useState(false)
  const [maisOpcoes, setMaisOpcoes] = useState(false)
  const [aba, setAba] = useState<'mapa' | 'leads'>('mapa')
  const [filtroStatus, setFiltroStatus] = useState<StatusLead | 'todos'>('todos')
  // Lead aberto no painel de detalhe + os pulados na triagem atual (não voltam na fila).
  const [leadAbertoId, setLeadAbertoId] = useState<number | null>(null)
  const [pulados, setPulados] = useState<Set<number>>(new Set())
  // "Abrir o primeiro pendente" resolvido na renderização — o aviso pós-busca dispara isso
  // antes da lista recarregada chegar, então não dá pra escolher o lead na hora do clique.
  const [triagemSolicitada, setTriagemSolicitada] = useState(false)

  const { resultados, loading: buscando, error: erroBusca, buscar } = useBuscaNicho()
  const { leads, loading: carregandoLeads, salvar, atualizarStatus, excluir, recarregar: recarregarLeads } = useLeadsMapeados()

  const pendentes = useMemo(() => leads.filter((l) => l.status === 'pendente'), [leads])
  const leadAberto =
    leadAbertoId !== null
      ? (leads.find((l) => l.id === leadAbertoId) ?? null)
      : triagemSolicitada
        ? (pendentes.find((l) => !pulados.has(l.id)) ?? null)
        : null
  const filaTriagem = pendentes.filter((l) => l.id !== leadAberto?.id && !pulados.has(l.id))

  const abrirLead = (lead: LeadMapeado) => {
    setTriagemSolicitada(false)
    setLeadAbertoId(lead.id)
  }

  const fecharPainel = () => {
    setTriagemSolicitada(false)
    setLeadAbertoId(null)
  }

  const iniciarTriagem = () => {
    setPulados(new Set())
    setLeadAbertoId(null)
    setTriagemSolicitada(true)
  }

  const avancarTriagem = (atual: LeadMapeado, puladosAtuais = pulados) => {
    const proximo = pendentes.find((l) => l.id !== atual.id && !puladosAtuais.has(l.id))
    setTriagemSolicitada(false)
    setLeadAbertoId(proximo?.id ?? null)
    if (!proximo) toast.success('Tudo classificado por aqui!')
  }

  const handleBuscar = async () => {
    if (!nicho.trim()) {
      toast.error('Informe um nicho pra buscar (ex.: barbearia).')
      return
    }
    setModoAdicionarPonto(false)
    const { novosSalvos } = await buscar(nicho, [{ lat: centro.lat, lon: centro.lon }, ...pontosExtras], raioMetros)
    if (novosSalvos > 0) {
      await recarregarLeads()
      toast.success(`${novosSalvos} novo(s) lead(s) salvo(s) — falta classificar.`, {
        action: { label: 'Classificar', onClick: () => iniciarTriagem() },
      })
    }
  }

  const handleAdicionarPonto = (lat: number, lon: number) => {
    setPontosExtras((atual) => {
      if (atual.length >= MAX_PONTOS_EXTRAS) {
        toast.error(`Máximo de ${MAX_PONTOS_EXTRAS} pontos extras por busca.`)
        return atual
      }
      return [...atual, { lat, lon }]
    })
  }

  const handleRemoverPonto = (index: number) => {
    setPontosExtras((atual) => atual.filter((_, i) => i !== index))
  }

  const handleSalvar = async (resultado: ResultadoBusca, status: StatusLead) => {
    try {
      await salvar({
        nome: resultado.nome,
        latitude: resultado.latitude,
        longitude: resultado.longitude,
        origemTipo: resultado.origemTipo,
        origemId: resultado.origemId,
        nicho,
        endereco: resultado.endereco,
        cidade: resultado.cidade,
        telefone: resultado.telefone,
        status,
      })
      toast.success(`"${resultado.nome}" salvo como ${LABEL_STATUS[status]}.`)
    } catch (err) {
      console.error('Erro ao salvar lead:', err)
      toast.error('Não foi possível salvar esse lead.')
    }
  }

  const handleAtualizarStatus = async (id: number, status: StatusLead) => {
    try {
      await atualizarStatus(id, status)
    } catch (err) {
      console.error('Erro ao atualizar status:', err)
      toast.error('Não foi possível atualizar o status.')
    }
  }

  const handleExcluir = async (id: number) => {
    try {
      await excluir(id)
      toast.success('Lead removido.')
    } catch (err) {
      console.error('Erro ao excluir lead:', err)
      toast.error('Não foi possível remover esse lead.')
    }
  }

  // Classificar pelo painel: se era um pendente, já abre o próximo da fila (triagem).
  const handleClassificarNoPainel = (lead: LeadMapeado, status: StatusLead) => {
    const eraPendente = lead.status === 'pendente'
    handleAtualizarStatus(lead.id, status)
    if (eraPendente && status !== 'pendente') {
      toast.success(`${lead.nome}: ${LABEL_STATUS[status]}`, { duration: 1500 })
      avancarTriagem(lead)
    }
  }

  const handleExcluirNoPainel = (lead: LeadMapeado) => {
    handleExcluir(lead.id)
    if (lead.status === 'pendente') avancarTriagem(lead)
    else fecharPainel()
  }

  const handlePular = () => {
    if (!leadAberto) return
    const novos = new Set(pulados).add(leadAberto.id)
    setPulados(novos)
    avancarTriagem(leadAberto, novos)
  }

  const mapa = (
    <div className="h-[60vh] overflow-hidden rounded-lg border sm:h-[500px]">
      <MapaProspeccao
        centro={centro}
        nomeCentro={nomeCentro}
        raioMetros={raioMetros}
        resultados={resultados}
        leadsSalvos={leads}
        pontosExtras={pontosExtras}
        modoAdicionarPonto={modoAdicionarPonto}
        onAdicionarPonto={handleAdicionarPonto}
        onRemoverPonto={handleRemoverPonto}
        onSalvar={handleSalvar}
        onAtualizarStatus={handleAtualizarStatus}
        onExcluir={handleExcluir}
        onAbrirLead={isMobile ? abrirLead : undefined}
      />
    </div>
  )

  const lista = (
    <LeadsSalvosLista
      modo="classificar"
      leads={leads}
      loading={carregandoLeads}
      centro={centro}
      onAtualizarStatus={handleAtualizarStatus}
      onExcluir={handleExcluir}
      onAbrirLead={abrirLead}
      filtroStatus={filtroStatus}
      onFiltroStatusChange={setFiltroStatus}
    />
  )

  return (
    <div className="flex flex-col gap-4 p-4 md:gap-6 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Mapeamento de leads</h1>
        <p className="text-sm text-muted-foreground">
          Busque estabelecimentos por nicho e classifique como cliente, concorrente ou lead
        </p>
      </div>

      <Card className="gap-0 py-4">
        <CardContent className="flex flex-col gap-3 px-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1 sm:max-w-72">
              <label className="text-xs text-muted-foreground" htmlFor="nicho">
                Nicho
              </label>
              <Input
                id="nicho"
                placeholder="ex.: barbearia, salão de beleza..."
                value={nicho}
                onChange={(e) => setNicho(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
                enterKeyHint="search"
              />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Raio</label>
                <Select value={String(raioMetros)} onValueChange={(v) => setRaioMetros(Number(v))}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPCOES_RAIO.map((op) => (
                      <SelectItem key={op.valor} value={String(op.valor)}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleBuscar} disabled={buscando} className="flex-1 sm:flex-none">
                {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar
              </Button>
            </div>
          </div>

          {/* No celular, ponto de partida e pontos extras ficam recolhidos pra o mapa subir. */}
          <button
            type="button"
            onClick={() => setMaisOpcoes((v) => !v)}
            className="flex items-center gap-1 self-start text-xs font-medium text-muted-foreground sm:hidden"
            aria-expanded={maisOpcoes}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', maisOpcoes && 'rotate-180')} />
            {maisOpcoes ? 'Menos opções' : 'Ponto de partida e área de busca'}
            {pontosExtras.length > 0 && ` · ${pontosExtras.length} ponto(s) extra(s)`}
          </button>

          <div
            className={cn(
              'flex-col gap-3 animate-in fade-in-0 slide-in-from-top-1 duration-200 sm:flex',
              maisOpcoes ? 'flex' : 'hidden'
            )}
          >
            <div className="border-t pt-3">
              <PontoPartidaCampo ponto={ponto} />
            </div>
            <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Button
                variant={modoAdicionarPonto ? 'default' : 'outline'}
                onClick={() => {
                  setModoAdicionarPonto((v) => !v)
                  if (isMobile) setAba('mapa')
                }}
              >
                <MapPinPlus className="h-4 w-4" />
                {modoAdicionarPonto ? 'Toque no mapa pra adicionar...' : 'Adicionar ponto de busca'}
              </Button>
              {pontosExtras.length > 0 && (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    {pontosExtras.length} ponto(s) extra(s) — cada um busca até 20 resultados no raio.
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => setPontosExtras([])}>
                    <X className="h-4 w-4" />
                    Limpar
                  </Button>
                </div>
              )}
            </div>
          </div>

          {erroBusca && <p className="text-sm text-destructive">{erroBusca}</p>}
          {!buscando && resultados.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {resultados.length} resultado(s) — os novos já foram salvos como &quot;A classificar&quot;.
            </p>
          )}
        </CardContent>
      </Card>

      {pendentes.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-sky-400/40 bg-sky-500/5 p-3 animate-in fade-in-0">
          <Sparkles className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">{pendentes.length}</span> lead(s) a classificar
          </p>
          <Button size="sm" onClick={iniciarTriagem}>
            Classificar agora
          </Button>
        </div>
      )}

      {isMobile ? (
        <Tabs value={aba} onValueChange={(v) => setAba(v as 'mapa' | 'leads')}>
          <TabsList className="w-full">
            <TabsTrigger value="mapa" className="flex-1">
              <MapIcon className="h-4 w-4" />
              Mapa
            </TabsTrigger>
            <TabsTrigger value="leads" className="flex-1">
              <List className="h-4 w-4" />
              Leads ({leads.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="mapa" className="animate-in fade-in-0 duration-200">
            {mapa}
          </TabsContent>
          <TabsContent value="leads" className="animate-in fade-in-0 duration-200">
            {lista}
          </TabsContent>
        </Tabs>
      ) : (
        <>
          {mapa}
          {lista}
        </>
      )}

      <LeadDetalheSheet
        lead={leadAberto}
        onOpenChange={(v) => !v && fecharPainel()}
        onClassificar={handleClassificarNoPainel}
        onExcluir={handleExcluirNoPainel}
        pendentesRestantes={leadAberto?.status === 'pendente' ? filaTriagem.length : 0}
        onPular={handlePular}
      />
    </div>
  )
}
