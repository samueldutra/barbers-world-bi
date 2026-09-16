'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { Search, Loader2, MapPinPlus, Route, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LeadsSalvosLista } from '@/components/prospeccao/leads-salvos-lista'
import { RotasSalvasLista } from '@/components/prospeccao/rotas-salvas-lista'
import { useBuscaNicho, type ResultadoBusca, type PontoBusca } from '@/hooks/use-busca-nicho'
import { useLeadsMapeados, type StatusLead } from '@/hooks/use-leads-mapeados'
import { useRotasVisita } from '@/hooks/use-rotas-visita'

const MapaProspeccao = dynamic(
  () => import('@/components/prospeccao/mapa-prospeccao').then((m) => m.MapaProspeccao),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> }
)

// Maringá, PR — geocodificado via Nominatim. Ajustável na tela pelo campo de endereço.
const CENTRO_PADRAO = { lat: -23.425269, lon: -51.9382078 }
const NOME_CENTRO_PADRAO = 'Barbers World (Maringá, PR)'

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

// O link de rota do Google Maps aceita no máximo ~25 pontos (origem + destino + waypoints).
const MAX_PARADAS_ROTA = 23

export default function ProspeccaoPage() {
  const [nicho, setNicho] = useState('barbearia')
  const [raioMetros, setRaioMetros] = useState(5000)
  const [enderecoBase, setEnderecoBase] = useState('Maringá, PR')
  const [centro, setCentro] = useState(CENTRO_PADRAO)
  const [nomeCentro, setNomeCentro] = useState(NOME_CENTRO_PADRAO)
  const [geocodificando, setGeocodificando] = useState(false)
  const [pontosExtras, setPontosExtras] = useState<PontoBusca[]>([])
  const [modoAdicionarPonto, setModoAdicionarPonto] = useState(false)
  const [modoSelecionarRota, setModoSelecionarRota] = useState(false)
  const [leadsSelecionadosRota, setLeadsSelecionadosRota] = useState<Set<number>>(new Set())

  const { resultados, loading: buscando, error: erroBusca, buscar } = useBuscaNicho()
  const { leads, loading: carregandoLeads, salvar, atualizarStatus, excluir, recarregar: recarregarLeads } = useLeadsMapeados()
  const {
    rotas,
    loading: carregandoRotas,
    salvar: salvarRota,
    carregarParadas,
    atualizarStatus: atualizarStatusRota,
    atualizarParada,
    excluir: excluirRota,
  } = useRotasVisita()

  const handleBuscar = async () => {
    if (!nicho.trim()) {
      toast.error('Informe um nicho pra buscar (ex.: barbearia).')
      return
    }
    const { novosSalvos } = await buscar(nicho, [{ lat: centro.lat, lon: centro.lon }, ...pontosExtras], raioMetros)
    if (novosSalvos > 0) {
      toast.success(`${novosSalvos} novo(s) lead(s) salvo(s) automaticamente — falta só classificar.`)
      recarregarLeads()
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

  const handleToggleModoSelecionarRota = () => {
    setModoAdicionarPonto(false)
    setModoSelecionarRota((v) => !v)
  }

  const handleToggleLeadRota = (id: number) => {
    setLeadsSelecionadosRota((atual) => {
      const novo = new Set(atual)
      if (novo.has(id)) {
        novo.delete(id)
      } else {
        if (novo.size >= MAX_PARADAS_ROTA) {
          toast.error(`Máximo de ${MAX_PARADAS_ROTA} paradas por rota.`)
          return atual
        }
        novo.add(id)
      }
      return novo
    })
  }

  const handleLimparSelecaoRota = () => setLeadsSelecionadosRota(new Set())

  const handleSalvarRota = async (
    nome: string,
    descricao: string | null,
    leadIds: number[],
    pontoPartidaEndereco?: string | null
  ) => {
    try {
      await salvarRota(nome, leadIds, descricao, pontoPartidaEndereco)
      toast.success(`Rota "${nome}" salva com ${leadIds.length} parada(s).`)
    } catch (err) {
      console.error('Erro ao salvar rota:', err)
      toast.error('Não foi possível salvar essa rota.')
      throw err
    }
  }

  const handleAtualizarStatusRota = async (id: number, status: Parameters<typeof atualizarStatusRota>[1]) => {
    try {
      await atualizarStatusRota(id, status)
    } catch (err) {
      console.error('Erro ao atualizar status da rota:', err)
      toast.error('Não foi possível atualizar o status da rota.')
    }
  }

  const handleAtualizarParada = async (paradaId: number, visitaRealizada: boolean) => {
    await atualizarParada(paradaId, visitaRealizada)
  }

  const handleExcluirRota = async (id: number) => {
    await excluirRota(id)
  }

  const handleRecentralizar = async () => {
    if (!enderecoBase.trim()) return
    setGeocodificando(true)
    try {
      const resposta = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(enderecoBase)}`
      )
      const dados = await resposta.json()
      if (!Array.isArray(dados) || dados.length === 0) {
        toast.error('Endereço não encontrado.')
        return
      }
      const { lat, lon, display_name } = dados[0]
      setCentro({ lat: Number(lat), lon: Number(lon) })
      setNomeCentro(display_name)
      toast.success('Ponto de partida atualizado.')
    } catch (err) {
      console.error('Erro ao geocodificar endereço:', err)
      toast.error('Não foi possível localizar esse endereço.')
    } finally {
      setGeocodificando(false)
    }
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
      toast.success(`"${resultado.nome}" salvo como ${status}.`)
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

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Prospecção de leads</h1>
        <p className="text-sm text-muted-foreground">
          Busque estabelecimentos por nicho perto da Barbers World e classifique como cliente, concorrente ou lead
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Buscar no mapa</CardTitle>
          <CardDescription>Dados do Google Places</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Nicho</label>
              <Input
                placeholder="ex.: barbearia, salão de beleza, academia..."
                value={nicho}
                onChange={(e) => setNicho(e.target.value)}
                className="w-64"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Raio</label>
              <Select value={String(raioMetros)} onValueChange={(v) => setRaioMetros(Number(v))}>
                <SelectTrigger className="w-28">
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
            <Button onClick={handleBuscar} disabled={buscando}>
              {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </Button>
          </div>

          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Ponto de partida (endereço/cidade)</label>
              <Input
                placeholder="ex.: Av. Brasil, 1000, Maringá, PR"
                value={enderecoBase}
                onChange={(e) => setEnderecoBase(e.target.value)}
                className="w-80"
              />
            </div>
            <Button variant="outline" onClick={handleRecentralizar} disabled={geocodificando}>
              {geocodificando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Recentralizar
            </Button>
            <p className="text-xs text-muted-foreground">{nomeCentro}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              variant={modoAdicionarPonto ? 'default' : 'outline'}
              onClick={() => {
                setModoSelecionarRota(false)
                setModoAdicionarPonto((v) => !v)
              }}
            >
              <MapPinPlus className="h-4 w-4" />
              {modoAdicionarPonto ? 'Clique no mapa pra adicionar...' : 'Adicionar ponto de busca'}
            </Button>
            {pontosExtras.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground">
                  {pontosExtras.length} ponto(s) extra(s) — cada um busca até 20 resultados no raio escolhido.
                </p>
                <Button variant="ghost" size="sm" onClick={() => setPontosExtras([])}>
                  <X className="h-4 w-4" />
                  Limpar pontos
                </Button>
              </>
            )}
          </div>

          {erroBusca && <p className="text-sm text-destructive">{erroBusca}</p>}
          {!buscando && resultados.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {resultados.length} resultado(s) encontrado(s) — os novos já foram salvos como &quot;A classificar&quot;, é só marcar o status na lista abaixo.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={modoSelecionarRota ? 'default' : 'outline'} onClick={handleToggleModoSelecionarRota}>
          <Route className="h-4 w-4" />
          {modoSelecionarRota ? 'Clique nos leads do mapa pra adicionar à rota...' : 'Selecionar pontos no mapa pra rota'}
        </Button>
        {leadsSelecionadosRota.size > 0 && (
          <>
            <p className="text-xs text-muted-foreground">{leadsSelecionadosRota.size} ponto(s) selecionado(s) pra rota.</p>
            <Button variant="ghost" size="sm" onClick={handleLimparSelecaoRota}>
              <X className="h-4 w-4" />
              Limpar seleção
            </Button>
          </>
        )}
      </div>

      <div className="h-[500px] overflow-hidden rounded-lg border">
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
          modoSelecionarRota={modoSelecionarRota}
          leadsSelecionadosRota={leadsSelecionadosRota}
          onToggleLeadRota={handleToggleLeadRota}
        />
      </div>

      <RotasSalvasLista
        rotas={rotas}
        loading={carregandoRotas}
        centro={centro}
        leads={leads}
        onCarregarParadas={carregarParadas}
        onAtualizarStatusRota={handleAtualizarStatusRota}
        onAtualizarParada={handleAtualizarParada}
        onExcluirRota={handleExcluirRota}
        onCriarRota={handleSalvarRota}
      />

      <LeadsSalvosLista
        leads={leads}
        loading={carregandoLeads}
        centro={centro}
        selecionados={leadsSelecionadosRota}
        onToggleSelecionado={handleToggleLeadRota}
        onLimparSelecao={handleLimparSelecaoRota}
        onSalvarRota={handleSalvarRota}
        onAtualizarStatus={handleAtualizarStatus}
        onExcluir={handleExcluir}
      />
    </div>
  )
}
