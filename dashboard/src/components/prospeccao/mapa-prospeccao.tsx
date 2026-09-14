'use client'

import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Button } from '@/components/ui/button'
import type { ResultadoBusca } from '@/hooks/use-busca-nicho'
import type { LeadMapeado, StatusLead } from '@/hooks/use-leads-mapeados'

/** Ícones coloridos por status via divIcon (círculo CSS) — evita ter que importar/servir
 * os PNGs padrão do Leaflet, que quebram fácil com bundlers. */
const CORES: Record<string, string> = {
  cliente: '#102694', // azul da marca
  concorrente: '#78716c', // cinza neutro (não usamos vermelho fora de erro/destrutivo)
  lead: '#f59e0b', // âmbar
  resultado: '#94a3b8', // cinza claro — resultado de busca ainda não salvo
  centro: '#16a34a', // verde — ponto de partida (Barbers World)
}

function criarIcone(chave: keyof typeof CORES, tamanho = 16): L.DivIcon {
  const cor = CORES[chave]
  return L.divIcon({
    className: 'marcador-prospeccao',
    html: `<div style="background:${cor};width:${tamanho}px;height:${tamanho}px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.45)"></div>`,
    iconSize: [tamanho, tamanho],
    iconAnchor: [tamanho / 2, tamanho / 2],
  })
}

const ICONE_CENTRO = criarIcone('centro', 20)
const ICONE_RESULTADO = criarIcone('resultado')
const ICONES_STATUS: Record<StatusLead, L.DivIcon> = {
  cliente: criarIcone('cliente'),
  concorrente: criarIcone('concorrente'),
  lead: criarIcone('lead'),
}

const LABEL_STATUS: Record<StatusLead, string> = {
  cliente: 'Cliente',
  concorrente: 'Concorrente',
  lead: 'Lead',
}

function RecentrarMapa({ centro }: { centro: { lat: number; lon: number } }) {
  const map = useMap()
  useEffect(() => {
    map.setView([centro.lat, centro.lon], map.getZoom())
  }, [centro, map])
  return null
}

interface Props {
  centro: { lat: number; lon: number }
  nomeCentro: string
  resultados: ResultadoBusca[]
  leadsSalvos: LeadMapeado[]
  onSalvar: (resultado: ResultadoBusca, status: StatusLead) => void
  onAtualizarStatus: (id: number, status: StatusLead) => void
  onExcluir: (id: number) => void
}

export function MapaProspeccao({ centro, nomeCentro, resultados, leadsSalvos, onSalvar, onAtualizarStatus, onExcluir }: Props) {
  const salvosPorOsm = useMemo(
    () => new Set(leadsSalvos.filter((l) => l.osm_type && l.osm_id).map((l) => `${l.osm_type}:${l.osm_id}`)),
    [leadsSalvos]
  )
  const resultadosNaoSalvos = resultados.filter((r) => !salvosPorOsm.has(`${r.osmType}:${r.osmId}`))

  return (
    <MapContainer center={[centro.lat, centro.lon]} zoom={13} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <RecentrarMapa centro={centro} />

      <Marker position={[centro.lat, centro.lon]} icon={ICONE_CENTRO}>
        <Popup>
          <span className="text-sm font-medium">{nomeCentro}</span>
          <br />
          <span className="text-xs text-muted-foreground">Ponto de partida</span>
        </Popup>
      </Marker>

      {resultadosNaoSalvos.map((r) => (
        <Marker key={`${r.osmType}-${r.osmId}`} position={[r.latitude, r.longitude]} icon={ICONE_RESULTADO}>
          <Popup>
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium">{r.nome}</p>
              {r.endereco && <p className="text-xs text-muted-foreground">{r.endereco}</p>}
              {r.telefone && <p className="text-xs text-muted-foreground">{r.telefone}</p>}
              <div className="flex flex-wrap gap-1 pt-1">
                <Button size="sm" variant="outline" onClick={() => onSalvar(r, 'cliente')}>
                  Cliente
                </Button>
                <Button size="sm" variant="outline" onClick={() => onSalvar(r, 'concorrente')}>
                  Concorrente
                </Button>
                <Button size="sm" variant="outline" onClick={() => onSalvar(r, 'lead')}>
                  Lead
                </Button>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}

      {leadsSalvos.map((lead) => (
        <Marker key={`lead-${lead.id}`} position={[lead.latitude, lead.longitude]} icon={ICONES_STATUS[lead.status]}>
          <Popup>
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium">{lead.nome}</p>
              {lead.endereco && <p className="text-xs text-muted-foreground">{lead.endereco}</p>}
              <p className="text-xs font-medium uppercase text-muted-foreground">{LABEL_STATUS[lead.status]}</p>
              <div className="flex flex-wrap gap-1 pt-1">
                {(['cliente', 'concorrente', 'lead'] as StatusLead[]).map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={lead.status === status ? 'default' : 'outline'}
                    onClick={() => onAtualizarStatus(lead.id, status)}
                  >
                    {LABEL_STATUS[status]}
                  </Button>
                ))}
              </div>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onExcluir(lead.id)}>
                Remover
              </Button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
