'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { MousePointerClick, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { LeadsSalvosLista } from '@/components/prospeccao/leads-salvos-lista'
import { RotasSalvasLista } from '@/components/prospeccao/rotas-salvas-lista'
import { PontoPartidaCampo } from '@/components/prospeccao/ponto-partida-campo'
import { useLeadsMapeados, type StatusLead } from '@/hooks/use-leads-mapeados'
import { useRotasVisita } from '@/hooks/use-rotas-visita'
import { usePontoPartida } from '@/hooks/use-ponto-partida'
import { MAX_PARADAS_ROTA } from '@/lib/prospeccao'

const MapaProspeccao = dynamic(
  () => import('@/components/prospeccao/mapa-prospeccao').then((m) => m.MapaProspeccao),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> }
)

/** Rotas: montar rotas de visita a partir dos leads já mapeados e acompanhar a execução.
 * Encontrar e classificar leads fica em /prospeccao/mapeamento. */
export default function RotasPage() {
  const ponto = usePontoPartida()
  const { centro, nomeCentro } = ponto
  // Nesta tela o clique no lead do mapa escolhe a parada; desligado, abre os detalhes.
  const [modoSelecionarRota, setModoSelecionarRota] = useState(true)
  const [leadsSelecionados, setLeadsSelecionados] = useState<Set<number>>(new Set())

  const { leads, loading: carregandoLeads, atualizarStatus, excluir } = useLeadsMapeados()
  const {
    rotas,
    loading: carregandoRotas,
    salvar: salvarRota,
    carregarParadas,
    atualizarStatus: atualizarStatusRota,
    atualizarParada,
    excluir: excluirRota,
  } = useRotasVisita()

  const handleToggleLead = (id: number) => {
    setLeadsSelecionados((atual) => {
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

  const handleLimparSelecao = () => setLeadsSelecionados(new Set())

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

  // O mapa ainda permite ajustar o status/remover um lead pelo balão (com a seleção desligada).
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
      setLeadsSelecionados((atual) => {
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

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Rotas de visita</h1>
        <p className="text-sm text-muted-foreground">
          Monte rotas com os leads mapeados, exporte para o Google Maps/PDF e acompanhe as visitas
        </p>
      </div>

      <RotasSalvasLista
        rotas={rotas}
        loading={carregandoRotas}
        centro={centro}
        leads={leads}
        onCarregarParadas={carregarParadas}
        onAtualizarStatusRota={handleAtualizarStatusRota}
        onAtualizarParada={atualizarParada}
        onExcluirRota={excluirRota}
        onCriarRota={handleSalvarRota}
      />

      <Card>
        <CardHeader>
          <CardTitle>Montar nova rota</CardTitle>
          <CardDescription>
            Clique nos leads do mapa (ou marque na lista abaixo) na ordem em que quer visitar — até {MAX_PARADAS_ROTA} paradas
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <PontoPartidaCampo ponto={ponto} />
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button variant={modoSelecionarRota ? 'default' : 'outline'} onClick={() => setModoSelecionarRota((v) => !v)}>
              <MousePointerClick className="h-4 w-4" />
              {modoSelecionarRota ? 'Clique no mapa escolhe a parada' : 'Clique no mapa mostra detalhes'}
            </Button>
            {leadsSelecionados.size > 0 && (
              <>
                <p className="text-xs text-muted-foreground">{leadsSelecionados.size} parada(s) selecionada(s).</p>
                <Button variant="ghost" size="sm" onClick={handleLimparSelecao}>
                  <X className="h-4 w-4" />
                  Limpar seleção
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="h-[500px] overflow-hidden rounded-lg border">
        <MapaProspeccao
          centro={centro}
          nomeCentro={nomeCentro}
          leadsSalvos={leads}
          onAtualizarStatus={handleAtualizarStatusLead}
          onExcluir={handleExcluirLead}
          modoSelecionarRota={modoSelecionarRota}
          leadsSelecionadosRota={leadsSelecionados}
          onToggleLeadRota={handleToggleLead}
        />
      </div>

      <LeadsSalvosLista
        modo="rota"
        leads={leads}
        loading={carregandoLeads}
        centro={centro}
        selecionados={leadsSelecionados}
        onToggleSelecionado={handleToggleLead}
        onLimparSelecao={handleLimparSelecao}
        onSalvarRota={handleSalvarRota}
      />
    </div>
  )
}
