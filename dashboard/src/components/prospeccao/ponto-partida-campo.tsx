'use client'

import { Loader2, LocateFixed, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { PontoPartida } from '@/hooks/use-ponto-partida'

export function PontoPartidaCampo({ ponto }: { ponto: PontoPartida }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-muted-foreground" htmlFor="ponto-partida">
        Ponto de partida (endereço/cidade)
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id="ponto-partida"
          placeholder="ex.: Av. Brasil, 1000, Maringá, PR"
          value={ponto.endereco}
          onChange={(e) => ponto.setEndereco(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ponto.recentralizar()}
          enterKeyHint="search"
          className="w-full sm:w-80"
        />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button variant="outline" onClick={ponto.recentralizar} disabled={ponto.geocodificando || !ponto.endereco.trim()}>
            {ponto.geocodificando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Recentralizar
          </Button>
          <Button variant="outline" onClick={ponto.usarMinhaLocalizacao} disabled={ponto.geocodificando}>
            <LocateFixed className="h-4 w-4" />
            Minha localização
          </Button>
        </div>
      </div>
      <p className="truncate text-xs text-muted-foreground">{ponto.nomeCentro}</p>
    </div>
  )
}
