'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, MousePointerClick, Route, Save, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { LeadsSalvosLista } from '@/components/prospeccao/leads-salvos-lista'
import { PontoPartidaCampo } from '@/components/prospeccao/ponto-partida-campo'
import { SalvarRotaDialog } from '@/components/prospeccao/rotas/salvar-rota-dialog'
import { useLeadsMapeados, type LeadMapeado, type StatusLead } from '@/hooks/use-leads-mapeados'
import { useRotasVisita } from '@/hooks/use-rotas-visita'
import { usePontoPartida } from '@/hooks/use-ponto-partida'
import { montarUrlRota } from '@/lib/google-maps-route'
import { CENTRO_PADRAO, MAX_PARADAS_ROTA } from '@/lib/prospeccao'

const MapaProspeccao = dynamic(
  () => import('@/components/prospeccao/mapa-prospeccao').then((m) => m.MapaProspeccao),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> }
)

/** Montar rota nova escolhendo as paradas no mapa ou na lista. Ao salvar, abre a rota. */
export default function NovaRotaPage() {
  const router = useRouter()
  const ponto = usePontoPartida()
  const { centro, nomeCentro } = ponto
  // Nesta tela o toque no lead do mapa escolhe a parada; desligado, abre os detalhes.
  const [modoSelecionar, setModoSelecionar] = useState(true)
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [dialogSalvarAberto, setDialogSalvarAberto] = useState(false)

  const { leads, loading: carregandoLeads, atualizarStatus, excluir } = useLeadsMapeados()
  const { salvar } = useRotasVisita()

  const leadsSelecionados = useMemo(
    () =>
      Array.from(selecionados)
        .map((id) => leads.find((l) => l.id === id))
        .filter((l): l is LeadMapeado => l != null),
    [selecionados, leads]
  )

  // Só grava endereço de partida se o usuário trocou o padrão — sem ele a rota parte da
  // Barbers World (ver origemRota em lib/rotas.ts).
  const pontoPartidaAlterado = centro.lat !== CENTRO_PADRAO.lat || centro.lon !== CENTRO_PADRAO.lon

  const handleToggle = (id: number) => {
    setSelecionados((atual) => {
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

  const handleSalvar = async (
    nome: string,
    descricao: string | null,
    leadIds: number[],
    pontoPartidaEndereco: string | null
  ) => {
    try {
      const id = await salvar(nome, leadIds, descricao, pontoPartidaEndereco)
      toast.success(`Rota "${nome}" salva com ${leadIds.length} parada(s).`)
      router.push(`/prospeccao/rotas/${id}`)
    } catch (err) {
      console.error('Erro ao salvar rota:', err)
      toast.error('Não foi possível salvar essa rota.')
      throw err
    }
  }

  const handleAtualizarStatusLead = async (id: number, status: StatusLead) => {
    try {
      await atualizarStatus(id, status)
    } catch (err) {
      console.error('Erro ao atualizar status:', err)
      toast.error('Não foi possível atualizar o status.')
    }
  }

  const handleExcluirLead = async (id: number) => {
    try {
      await excluir(id)
      setSelecionados((atual) => {
        const novo = new Set(atual)
        novo.delete(id)
        return novo
      })
      toast.success('Lead removido.')
    } catch (err) {
      console.error('Erro ao excluir lead:', err)
      toast.error('Não foi possível remover esse lead.')
    }
  }

  const abrirNoMaps = () => window.open(montarUrlRota(centro, leadsSelecionados), '_blank')

  return (
    // pb-28 no celular: espaço pra barra fixa de ações não cobrir o fim da lista.
    <div className="flex flex-col gap-4 p-4 pb-28 animate-in fade-in-0 slide-in-from-right-4 duration-300 sm:pb-6 md:p-6">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
        <Link href="/prospeccao/rotas">
          <ArrowLeft className="h-4 w-4" />
          Rotas
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-semibold">Nova rota</h1>
        <p className="text-sm text-muted-foreground">
          Toque nos leads no mapa (ou na lista) na ordem em que quer visitar — até {MAX_PARADAS_ROTA} paradas
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ponto de partida</CardTitle>
          <CardDescription>Usado pra ordenar as paradas pela distância e como origem no Google Maps</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <PontoPartidaCampo ponto={ponto} />
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              variant={modoSelecionar ? 'default' : 'outline'}
              size="sm"
              onClick={() => setModoSelecionar((v) => !v)}
            >
              <MousePointerClick className="h-4 w-4" />
              {modoSelecionar ? 'Toque no mapa escolhe a parada' : 'Toque no mapa mostra detalhes'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="h-[50vh] overflow-hidden rounded-lg border sm:h-[500px]">
        <MapaProspeccao
          centro={centro}
          nomeCentro={nomeCentro}
          leadsSalvos={leads}
          onAtualizarStatus={handleAtualizarStatusLead}
          onExcluir={handleExcluirLead}
          modoSelecionarRota={modoSelecionar}
          leadsSelecionadosRota={selecionados}
          onToggleLeadRota={handleToggle}
        />
      </div>

      <LeadsSalvosLista
        modo="rota"
        leads={leads}
        loading={carregandoLeads}
        centro={centro}
        selecionados={selecionados}
        onToggleSelecionado={handleToggle}
        onLimparSelecao={() => setSelecionados(new Set())}
        onAbrirSalvarRota={() => setDialogSalvarAberto(true)}
      />

      {/* Barra fixa de ações no celular — sempre à mão enquanto rola mapa e lista. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur sm:hidden">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{selecionados.size} parada(s)</p>
            {selecionados.size > 0 && (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground"
                onClick={() => setSelecionados(new Set())}
              >
                <X className="h-3 w-3" />
                Limpar
              </button>
            )}
          </div>
          <Button variant="outline" size="icon" className="h-10 w-10" disabled={selecionados.size === 0} onClick={abrirNoMaps} aria-label="Ver no Google Maps sem salvar">
            <Route className="h-4 w-4" />
          </Button>
          <Button className="h-10" disabled={selecionados.size === 0} onClick={() => setDialogSalvarAberto(true)}>
            <Save className="h-4 w-4" />
            Salvar rota
          </Button>
        </div>
      </div>

      <SalvarRotaDialog
        open={dialogSalvarAberto}
        onOpenChange={setDialogSalvarAberto}
        leadsSelecionados={leadsSelecionados}
        centro={centro}
        pontoPartidaEndereco={pontoPartidaAlterado ? nomeCentro : null}
        onSalvar={handleSalvar}
      />
    </div>
  )
}
