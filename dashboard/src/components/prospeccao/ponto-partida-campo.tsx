'use client'

import { Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { PontoPartida } from '@/hooks/use-ponto-partida'

export function PontoPartidaCampo({ ponto }: { ponto: PontoPartida }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Ponto de partida (endereço/cidade)</label>
        <Input
          placeholder="ex.: Av. Brasil, 1000, Maringá, PR"
          value={ponto.endereco}
          onChange={(e) => ponto.setEndereco(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ponto.recentralizar()}
          className="w-80"
        />
      </div>
      <Button variant="outline" onClick={ponto.recentralizar} disabled={ponto.geocodificando}>
        {ponto.geocodificando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Recentralizar
      </Button>
      <p className="text-xs text-muted-foreground">{ponto.nomeCentro}</p>
    </div>
  )
}
