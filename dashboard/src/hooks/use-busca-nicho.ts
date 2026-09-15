'use client'

import { useState } from 'react'
import type { ResultadoBusca } from '@/app/api/prospeccao/buscar/route'

export type { ResultadoBusca }

export interface PontoBusca {
  lat: number
  lon: number
}

export function useBuscaNicho() {
  const [resultados, setResultados] = useState<ResultadoBusca[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buscar = async (nicho: string, pontos: PontoBusca[], raioMetros: number) => {
    setLoading(true)
    setError(null)
    try {
      const resposta = await fetch('/api/prospeccao/buscar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nicho,
          raioMetros,
          pontos: pontos.map((p) => ({ latitude: p.lat, longitude: p.lon })),
        }),
      })
      const dados = await resposta.json()
      if (!resposta.ok) throw new Error(dados.error || 'Erro na busca')
      setResultados((dados.resultados as ResultadoBusca[]) ?? [])
    } catch (err) {
      console.error('Erro ao buscar leads por nicho:', err)
      setError('Não foi possível buscar. Tente novamente em alguns segundos.')
      setResultados([])
    } finally {
      setLoading(false)
    }
  }

  return { resultados, loading, error, buscar, limparResultados: () => setResultados([]) }
}
