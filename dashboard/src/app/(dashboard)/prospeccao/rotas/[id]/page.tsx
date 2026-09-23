'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, CheckCircle2, Copy, ExternalLink, FileDown, List, Map as MapIcon, Navigation } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ParadaItem } from '@/components/prospeccao/rotas/parada-item'
import { RotaAcoesMenu } from '@/components/prospeccao/rotas/rota-acoes-menu'
import { useRotaVisita } from '@/hooks/use-rota-visita'
import { useIsMobile } from '@/hooks/use-mobile'
import { formatarData } from '@/lib/formatters'
import { montarUrlRota } from '@/lib/google-maps-route'
import { exportarRotaPDF } from '@/lib/pdf-rota'
import { LABEL_STATUS_ROTA, VARIANTE_STATUS_ROTA, origemRota, percentualVisitado } from '@/lib/rotas'
import type { ParadaRota, StatusRota } from '@/hooks/use-rotas-visita'

const MapaRota = dynamic(() => import('@/components/prospeccao/rotas/mapa-rota').then((m) => m.MapaRota), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
})

function VoltarParaRotas() {
  return (
    <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
      <Link href="/prospeccao/rotas">
        <ArrowLeft className="h-4 w-4" />
        Rotas
      </Link>
    </Button>
  )
}

export default function RotaDetalhePage() {
  const params = useParams<{ id: string }>()
  const id = Number(params.id)
  const router = useRouter()
  const isMobile = useIsMobile()
  const [aba, setAba] = useState<'paradas' | 'mapa'>('paradas')
  const [destacada, setDestacada] = useState<number | null>(null)
  const refsParadas = useRef(new Map<number, HTMLLIElement>())

  const { rota, paradas, loading, error, naoEncontrada, alternarVisita, atualizarStatus, excluir } = useRotaVisita(id)

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <VoltarParaRotas />
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (error || naoEncontrada || !rota) {
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <VoltarParaRotas />
        <Card className="items-center px-6 py-12 text-center text-sm text-muted-foreground">
          {error ?? 'Rota não encontrada — pode ter sido excluída.'}
        </Card>
      </div>
    )
  }

  const pct = percentualVisitado(rota)
  const proxima = paradas.find((p) => !p.visita_realizada) ?? null
  const todasVisitadas = paradas.length > 0 && !proxima
  const urlRota = paradas.length > 0 ? montarUrlRota(origemRota(rota), paradas) : ''

  const handleAlternarVisita = async (parada: ParadaRota) => {
    try {
      await alternarVisita(parada)
    } catch (err) {
      console.error('Erro ao atualizar parada:', err)
      toast.error('Não foi possível salvar a visita — verifique a conexão e tente de novo.')
    }
  }

  const handleAlterarStatus = async (status: StatusRota) => {
    try {
      await atualizarStatus(status)
      toast.success(`Rota marcada como ${LABEL_STATUS_ROTA[status].toLowerCase()}.`)
    } catch (err) {
      console.error('Erro ao atualizar status da rota:', err)
      toast.error('Não foi possível atualizar o status da rota.')
    }
  }

  const handleExcluir = async () => {
    try {
      await excluir()
      toast.success('Rota removida.')
      router.push('/prospeccao/rotas')
    } catch (err) {
      console.error('Erro ao excluir rota:', err)
      toast.error('Não foi possível remover essa rota.')
      throw err
    }
  }

  const handleCopiarLink = async () => {
    try {
      await navigator.clipboard.writeText(urlRota)
      toast.success('Link copiado!')
    } catch (err) {
      console.error('Erro ao copiar link da rota:', err)
      toast.error('Não foi possível copiar o link.')
    }
  }

  const handleExportarPDF = () =>
    exportarRotaPDF({
      nomeRota: rota.nome,
      descricao: rota.descricao,
      pontoPartida: rota.ponto_partida_endereco,
      paradas: paradas.map((p, i) => ({
        ordem: i + 1,
        nome: p.nome,
        endereco: p.endereco,
        cidade: p.cidade,
        telefone: p.telefone,
        latitude: p.latitude,
        longitude: p.longitude,
      })),
      urlGoogleMaps: urlRota,
    })

  // Toque num marcador: no celular volta pra lista; em ambos, rola até a parada e destaca.
  const handleSelecionarNoMapa = (parada: ParadaRota) => {
    if (isMobile) setAba('paradas')
    setDestacada(parada.parada_id)
    setTimeout(() => {
      refsParadas.current.get(parada.parada_id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
    setTimeout(() => setDestacada((d) => (d === parada.parada_id ? null : d)), 2000)
  }

  const listaParadas =
    paradas.length === 0 ? (
      <p className="py-8 text-center text-sm text-muted-foreground">Essa rota não tem paradas.</p>
    ) : (
      <ol className="flex flex-col gap-2">
        {paradas.map((parada, i) => (
          <ParadaItem
            key={parada.parada_id}
            ref={(el) => {
              if (el) refsParadas.current.set(parada.parada_id, el)
              else refsParadas.current.delete(parada.parada_id)
            }}
            parada={parada}
            ordem={i + 1}
            proxima={parada.parada_id === proxima?.parada_id}
            destacada={parada.parada_id === destacada}
            onAlternarVisita={() => handleAlternarVisita(parada)}
          />
        ))}
      </ol>
    )

  const mapa = (
    <div className="h-[60vh] overflow-hidden rounded-lg border lg:sticky lg:top-4 lg:h-[calc(100vh-10rem)]">
      <MapaRota paradas={paradas} idProxima={proxima?.parada_id ?? null} onSelecionar={handleSelecionarNoMapa} />
    </div>
  )

  return (
    <div className="flex flex-col gap-4 p-4 animate-in fade-in-0 slide-in-from-right-4 duration-300 md:p-6">
      <VoltarParaRotas />

      <Card className="gap-4 p-4 md:p-5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold leading-tight md:text-2xl">{rota.nome}</h1>
            {rota.descricao && <p className="mt-1 text-sm text-muted-foreground">{rota.descricao}</p>}
          </div>
          <Badge variant={VARIANTE_STATUS_ROTA[rota.status]} className="shrink-0">
            {LABEL_STATUS_ROTA[rota.status]}
          </Badge>
          <RotaAcoesMenu
            rota={rota}
            onAlterarStatus={handleAlterarStatus}
            onExcluir={handleExcluir}
            className="-mr-2 -mt-1 h-8 w-8 shrink-0"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-sm">
            <span>
              <span className="font-semibold tabular-nums">{rota.paradas_visitadas}</span>
              <span className="text-muted-foreground"> de {rota.total_paradas} visitada(s)</span>
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Navigation className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{rota.ponto_partida_endereco || 'Partida: Barbers World'}</span>
          <span className="shrink-0">· criada em {formatarData(new Date(rota.criado_em))}</span>
        </p>

        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          {urlRota ? (
            <Button className="col-span-3 h-10 sm:h-9" asChild>
              <a href={urlRota} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                Iniciar no Google Maps
              </a>
            </Button>
          ) : (
            <Button className="col-span-3 h-10 sm:h-9" disabled>
              <ExternalLink className="h-4 w-4" />
              Iniciar no Google Maps
            </Button>
          )}
          <Button variant="outline" onClick={handleCopiarLink} disabled={!urlRota} className="h-10 sm:h-9">
            <Copy className="h-4 w-4" />
            Link
          </Button>
          <Button variant="outline" onClick={handleExportarPDF} disabled={paradas.length === 0} className="h-10 sm:h-9">
            <FileDown className="h-4 w-4" />
            PDF
          </Button>
          {rota.status === 'planejada' && (
            <Button variant="outline" onClick={() => handleAlterarStatus('em_andamento')} className="h-10 sm:h-9">
              Iniciar
            </Button>
          )}
        </div>
      </Card>

      {todasVisitadas && rota.status !== 'concluida' && (
        <div className="flex flex-col gap-2 rounded-lg border border-green-600/30 bg-green-600/5 p-3 animate-in fade-in-0 slide-in-from-top-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            Todas as paradas foram visitadas.
          </p>
          <Button size="sm" onClick={() => handleAlterarStatus('concluida')}>
            Concluir rota
          </Button>
        </div>
      )}

      {isMobile ? (
        <Tabs value={aba} onValueChange={(v) => setAba(v as 'paradas' | 'mapa')}>
          <TabsList className="w-full">
            <TabsTrigger value="paradas" className="flex-1">
              <List className="h-4 w-4" />
              Paradas ({paradas.length})
            </TabsTrigger>
            <TabsTrigger value="mapa" className="flex-1">
              <MapIcon className="h-4 w-4" />
              Mapa
            </TabsTrigger>
          </TabsList>
          <TabsContent value="paradas" className="animate-in fade-in-0 duration-200">
            {listaParadas}
          </TabsContent>
          <TabsContent value="mapa" className="animate-in fade-in-0 duration-200">
            {mapa}
          </TabsContent>
        </Tabs>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>{listaParadas}</div>
          {mapa}
        </div>
      )}
    </div>
  )
}
