'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { geocodificarEndereco } from '@/lib/geocode'
import { CENTRO_PADRAO, ENDERECO_PADRAO, NOME_CENTRO_PADRAO } from '@/lib/prospeccao'

/** Ponto de partida do mapa (centro da busca no mapeamento; origem da rota nas rotas). */
export function usePontoPartida() {
  const [endereco, setEndereco] = useState(ENDERECO_PADRAO)
  const [centro, setCentro] = useState(CENTRO_PADRAO)
  const [nomeCentro, setNomeCentro] = useState(NOME_CENTRO_PADRAO)
  const [geocodificando, setGeocodificando] = useState(false)

  const recentralizar = async () => {
    if (!endereco.trim()) return
    setGeocodificando(true)
    try {
      const resultado = await geocodificarEndereco(endereco)
      if (!resultado) {
        toast.error('Endereço não encontrado.')
        return
      }
      setCentro({ lat: resultado.lat, lon: resultado.lon })
      setNomeCentro(resultado.nomeExibicao)
      toast.success('Ponto de partida atualizado.')
    } catch (err) {
      console.error('Erro ao geocodificar endereço:', err)
      toast.error('Não foi possível localizar esse endereço.')
    } finally {
      setGeocodificando(false)
    }
  }

  // Em campo, pelo celular: parte de onde a pessoa está (GPS do aparelho, pede permissão).
  const usarMinhaLocalizacao = () => {
    if (!('geolocation' in navigator)) {
      toast.error('Este navegador não informa a localização.')
      return
    }
    setGeocodificando(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCentro({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setNomeCentro('Minha localização atual')
        setEndereco('')
        setGeocodificando(false)
        toast.success('Ponto de partida: sua localização.')
      },
      (err) => {
        setGeocodificando(false)
        toast.error(
          err.code === err.PERMISSION_DENIED
            ? 'Permissão de localização negada — libere nas configurações do navegador.'
            : 'Não foi possível obter sua localização.'
        )
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    )
  }

  return { endereco, setEndereco, centro, nomeCentro, geocodificando, recentralizar, usarMinhaLocalizacao }
}

export type PontoPartida = ReturnType<typeof usePontoPartida>
