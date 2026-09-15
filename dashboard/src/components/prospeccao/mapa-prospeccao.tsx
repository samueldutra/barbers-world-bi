'use client'

import { useEffect, useState } from 'react'
import { APIProvider, Map, Marker, InfoWindow, useMap, type MapMouseEvent } from '@vis.gl/react-google-maps'
import { Button } from '@/components/ui/button'
import type { ResultadoBusca } from '@/hooks/use-busca-nicho'
import type { LeadMapeado, StatusLead } from '@/hooks/use-leads-mapeados'

/** Ícones coloridos por status via SVG inline (data URI) — não depende de Map ID nem do
 * script do Google já ter carregado (diferente de AdvancedMarker/google.maps.Size). */
const CORES: Record<string, string> = {
  cliente: '#102694', // azul da marca
  concorrente: '#78716c', // cinza neutro (não usamos vermelho fora de erro/destrutivo)
  lead: '#f59e0b', // âmbar
  resultado: '#94a3b8', // cinza claro — resultado de busca ainda não salvo
  centro: '#16a34a', // verde — ponto de partida (Barbers World)
  pontoExtra: '#9333ea', // roxo — ponto extra de busca adicionado pelo usuário
}

function svgCirculo(cor: string, tamanho = 18): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}"><circle cx="${tamanho / 2}" cy="${tamanho / 2}" r="${tamanho / 2 - 2}" fill="${cor}" stroke="white" stroke-width="2"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function svgCruz(cor: string, tamanho = 20): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}"><circle cx="${tamanho / 2}" cy="${tamanho / 2}" r="${tamanho / 2 - 2}" fill="${cor}" stroke="white" stroke-width="2"/><path d="M${tamanho / 2 - 4} ${tamanho / 2} h8 M${tamanho / 2} ${tamanho / 2 - 4} v8" stroke="white" stroke-width="2"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const ICONE_CENTRO = svgCirculo(CORES.centro, 22)
const ICONE_RESULTADO = svgCirculo(CORES.resultado)
const ICONE_PONTO_EXTRA = svgCruz(CORES.pontoExtra)
const ICONES_STATUS: Record<StatusLead, string> = {
  cliente: svgCirculo(CORES.cliente),
  concorrente: svgCirculo(CORES.concorrente),
  lead: svgCirculo(CORES.lead),
}

const LABEL_STATUS: Record<StatusLead, string> = {
  cliente: 'Cliente',
  concorrente: 'Concorrente',
  lead: 'Lead',
}

function RecentrarMapa({ centro }: { centro: { lat: number; lon: number } }) {
  const map = useMap()
  useEffect(() => {
    map?.panTo({ lat: centro.lat, lng: centro.lon })
  }, [centro, map])
  return null
}

/** Círculo translúcido mostrando a área coberta por cada ponto de busca (o Google Places
 * limita a 20 resultados por chamada — o círculo ajuda a visualizar por que é preciso
 * somar pontos em vez de só aumentar o raio de um único ponto). */
function CirculoRaio({ lat, lng, raioMetros, cor }: { lat: number; lng: number; raioMetros: number; cor: string }) {
  const map = useMap()
  useEffect(() => {
    if (!map || typeof google === 'undefined') return
    const circulo = new google.maps.Circle({
      map,
      center: { lat, lng },
      radius: raioMetros,
      strokeColor: cor,
      strokeOpacity: 0.5,
      strokeWeight: 1,
      fillColor: cor,
      fillOpacity: 0.07,
      clickable: false,
    })
    return () => circulo.setMap(null)
  }, [map, lat, lng, raioMetros, cor])
  return null
}

type SelecaoAberta =
  | { tipo: 'centro' }
  | { tipo: 'resultado'; item: ResultadoBusca }
  | { tipo: 'lead'; item: LeadMapeado }
  | { tipo: 'ponto-extra'; index: number; lat: number; lon: number }
  | null

interface Props {
  centro: { lat: number; lon: number }
  nomeCentro: string
  raioMetros: number
  resultados: ResultadoBusca[]
  leadsSalvos: LeadMapeado[]
  pontosExtras: { lat: number; lon: number }[]
  modoAdicionarPonto: boolean
  onAdicionarPonto: (lat: number, lon: number) => void
  onRemoverPonto: (index: number) => void
  onSalvar: (resultado: ResultadoBusca, status: StatusLead) => void
  onAtualizarStatus: (id: number, status: StatusLead) => void
  onExcluir: (id: number) => void
}

export function MapaProspeccao({
  centro,
  nomeCentro,
  raioMetros,
  resultados,
  leadsSalvos,
  pontosExtras,
  modoAdicionarPonto,
  onAdicionarPonto,
  onRemoverPonto,
  onSalvar,
  onAtualizarStatus,
  onExcluir,
}: Props) {
  const [selecionado, setSelecionado] = useState<SelecaoAberta>(null)
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  const salvosPorOrigem = new Set(
    leadsSalvos.filter((l) => l.origem_tipo && l.origem_id).map((l) => `${l.origem_tipo}:${l.origem_id}`)
  )
  const resultadosNaoSalvos = resultados.filter((r) => !salvosPorOrigem.has(`${r.origemTipo}:${r.origemId}`))

  if (!apiKey) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted p-6 text-center text-sm text-muted-foreground">
        Mapa não configurado — falta a variável NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.
      </div>
    )
  }

  const handleClickMapa = (evento: MapMouseEvent) => {
    const latLng = evento.detail.latLng
    if (modoAdicionarPonto && latLng) {
      onAdicionarPonto(latLng.lat, latLng.lng)
      return
    }
    setSelecionado(null)
  }

  return (
    <APIProvider apiKey={apiKey}>
      <Map
        defaultCenter={{ lat: centro.lat, lng: centro.lon }}
        defaultZoom={13}
        gestureHandling="greedy"
        disableDefaultUI={false}
        onClick={handleClickMapa}
        style={{ width: '100%', height: '100%', cursor: modoAdicionarPonto ? 'crosshair' : undefined }}
      >
        <RecentrarMapa centro={centro} />

        <CirculoRaio lat={centro.lat} lng={centro.lon} raioMetros={raioMetros} cor={CORES.centro} />
        {pontosExtras.map((p, i) => (
          <CirculoRaio key={`raio-${i}`} lat={p.lat} lng={p.lon} raioMetros={raioMetros} cor={CORES.pontoExtra} />
        ))}

        <Marker
          position={{ lat: centro.lat, lng: centro.lon }}
          icon={ICONE_CENTRO}
          onClick={() => setSelecionado({ tipo: 'centro' })}
        />

        {pontosExtras.map((p, i) => (
          <Marker
            key={`ponto-extra-${i}`}
            position={{ lat: p.lat, lng: p.lon }}
            icon={ICONE_PONTO_EXTRA}
            onClick={() => setSelecionado({ tipo: 'ponto-extra', index: i, lat: p.lat, lon: p.lon })}
          />
        ))}

        {resultadosNaoSalvos.map((r) => (
          <Marker
            key={`${r.origemTipo}-${r.origemId}`}
            position={{ lat: r.latitude, lng: r.longitude }}
            icon={ICONE_RESULTADO}
            onClick={() => setSelecionado({ tipo: 'resultado', item: r })}
          />
        ))}

        {leadsSalvos.map((lead) => (
          <Marker
            key={`lead-${lead.id}`}
            position={{ lat: lead.latitude, lng: lead.longitude }}
            icon={ICONES_STATUS[lead.status]}
            onClick={() => setSelecionado({ tipo: 'lead', item: lead })}
          />
        ))}

        {selecionado?.tipo === 'centro' && (
          <InfoWindow position={{ lat: centro.lat, lng: centro.lon }} onCloseClick={() => setSelecionado(null)}>
            <div className="text-sm">
              <p className="font-medium">{nomeCentro}</p>
              <p className="text-xs text-muted-foreground">Ponto de partida</p>
            </div>
          </InfoWindow>
        )}

        {selecionado?.tipo === 'ponto-extra' && (
          <InfoWindow
            position={{ lat: selecionado.lat, lng: selecionado.lon }}
            onCloseClick={() => setSelecionado(null)}
          >
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium">Ponto de busca extra</p>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (selecionado.tipo === 'ponto-extra') onRemoverPonto(selecionado.index)
                  setSelecionado(null)
                }}
              >
                Remover ponto
              </Button>
            </div>
          </InfoWindow>
        )}

        {selecionado?.tipo === 'resultado' && (
          <InfoWindow
            position={{ lat: selecionado.item.latitude, lng: selecionado.item.longitude }}
            onCloseClick={() => setSelecionado(null)}
          >
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium">{selecionado.item.nome}</p>
              {selecionado.item.endereco && <p className="text-xs text-muted-foreground">{selecionado.item.endereco}</p>}
              {selecionado.item.telefone && <p className="text-xs text-muted-foreground">{selecionado.item.telefone}</p>}
              <div className="flex flex-wrap gap-1 pt-1">
                {(['cliente', 'concorrente', 'lead'] as StatusLead[]).map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (selecionado.tipo === 'resultado') onSalvar(selecionado.item, status)
                      setSelecionado(null)
                    }}
                  >
                    {LABEL_STATUS[status]}
                  </Button>
                ))}
              </div>
            </div>
          </InfoWindow>
        )}

        {selecionado?.tipo === 'lead' && (
          <InfoWindow
            position={{ lat: selecionado.item.latitude, lng: selecionado.item.longitude }}
            onCloseClick={() => setSelecionado(null)}
          >
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium">{selecionado.item.nome}</p>
              {selecionado.item.endereco && <p className="text-xs text-muted-foreground">{selecionado.item.endereco}</p>}
              <p className="text-xs font-medium uppercase text-muted-foreground">{LABEL_STATUS[selecionado.item.status]}</p>
              <div className="flex flex-wrap gap-1 pt-1">
                {(['cliente', 'concorrente', 'lead'] as StatusLead[]).map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={selecionado.item.status === status ? 'default' : 'outline'}
                    onClick={() => {
                      if (selecionado.tipo === 'lead') onAtualizarStatus(selecionado.item.id, status)
                    }}
                  >
                    {LABEL_STATUS[status]}
                  </Button>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (selecionado.tipo === 'lead') onExcluir(selecionado.item.id)
                  setSelecionado(null)
                }}
              >
                Remover
              </Button>
            </div>
          </InfoWindow>
        )}
      </Map>
    </APIProvider>
  )
}
