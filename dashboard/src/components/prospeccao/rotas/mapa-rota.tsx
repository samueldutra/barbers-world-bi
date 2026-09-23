'use client'

import { useEffect } from 'react'
import { APIProvider, Map, Marker, useMap } from '@vis.gl/react-google-maps'
import type { ParadaRota } from '@/hooks/use-rotas-visita'

// Mesma paleta do mapa de prospecção: azul da marca = a visitar, verde = visitada,
// âmbar = próxima parada (a primeira ainda não visitada).
const COR_PENDENTE = '#102694'
const COR_VISITADA = '#16a34a'
const COR_PROXIMA = '#f59e0b'

function svgNumero(numero: number, cor: string, tamanho = 28): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}"><circle cx="${tamanho / 2}" cy="${tamanho / 2}" r="${tamanho / 2 - 2}" fill="${cor}" stroke="white" stroke-width="2"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="700" fill="white">${numero}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** Enquadra todas as paradas na tela (inclusive em celular, onde o zoom fixo cortaria). */
function EnquadrarParadas({ paradas }: { paradas: ParadaRota[] }) {
  const map = useMap()
  useEffect(() => {
    if (!map || paradas.length === 0 || typeof google === 'undefined') return
    if (paradas.length === 1) {
      map.setCenter({ lat: paradas[0].latitude, lng: paradas[0].longitude })
      map.setZoom(15)
      return
    }
    const bounds = new google.maps.LatLngBounds()
    for (const p of paradas) bounds.extend({ lat: p.latitude, lng: p.longitude })
    map.fitBounds(bounds, 48)
    // Só no carregamento — marcar visita não deve reenquadrar o mapa enquanto o usuário olha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, paradas.length])
  return null
}

interface Props {
  paradas: ParadaRota[]
  idProxima: number | null
  onSelecionar?: (parada: ParadaRota) => void
}

export function MapaRota({ paradas, idProxima, onSelecionar }: Props) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted p-6 text-center text-sm text-muted-foreground">
        Mapa não configurado — falta a variável NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.
      </div>
    )
  }

  const inicial = paradas[0] ?? { latitude: -23.425269, longitude: -51.9382078 }

  return (
    <APIProvider apiKey={apiKey}>
      <Map
        defaultCenter={{ lat: inicial.latitude, lng: inicial.longitude }}
        defaultZoom={13}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl
        style={{ width: '100%', height: '100%' }}
      >
        <EnquadrarParadas paradas={paradas} />
        {paradas.map((p, i) => (
          <Marker
            key={p.parada_id}
            position={{ lat: p.latitude, lng: p.longitude }}
            icon={svgNumero(
              i + 1,
              p.visita_realizada ? COR_VISITADA : p.parada_id === idProxima ? COR_PROXIMA : COR_PENDENTE
            )}
            title={`${i + 1}. ${p.nome}`}
            zIndex={p.parada_id === idProxima ? 1000 : paradas.length - i}
            onClick={() => onSelecionar?.(p)}
          />
        ))}
      </Map>
    </APIProvider>
  )
}
