'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ordenarPorProximidade } from '@/lib/distancia'
import type { LeadMapeado } from '@/hooks/use-leads-mapeados'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Na ordem em que foram escolhidos (mapa/lista). */
  leadsSelecionados: LeadMapeado[]
  centro: { lat: number; lon: number }
  pontoPartidaEndereco: string | null
  onSalvar: (nome: string, descricao: string | null, leadIds: number[], pontoPartidaEndereco: string | null) => Promise<void>
}

export function SalvarRotaDialog({ open, onOpenChange, leadsSelecionados, centro, pontoPartidaEndereco, onSalvar }: Props) {
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [ordenarPorDistancia, setOrdenarPorDistancia] = useState(true)
  const [salvando, setSalvando] = useState(false)

  const handleSalvar = async () => {
    if (!nome.trim()) return
    setSalvando(true)
    try {
      const ordenados = ordenarPorDistancia ? ordenarPorProximidade(centro, leadsSelecionados) : leadsSelecionados
      await onSalvar(nome.trim(), descricao.trim() || null, ordenados.map((l) => l.id), pontoPartidaEndereco)
      setNome('')
      setDescricao('')
      onOpenChange(false)
    } catch {
      // A página já avisou o erro (toast); mantém o diálogo aberto pra tentar de novo.
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !salvando && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Salvar rota de visita</DialogTitle>
          <DialogDescription>{leadsSelecionados.length} parada(s) selecionada(s).</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nome-rota">Nome</Label>
            <Input
              id="nome-rota"
              placeholder="ex.: Rota zona norte — semana 1"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSalvar()}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="descricao-rota">Descrição (opcional)</Label>
            <Textarea
              id="descricao-rota"
              placeholder="Observações sobre essa rota..."
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="ordenar-distancia"
              checked={ordenarPorDistancia}
              onCheckedChange={(v) => setOrdenarPorDistancia(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="ordenar-distancia" className="text-sm font-normal leading-snug">
              Ordenar pela distância a partir do ponto de partida (rota mais eficiente)
            </Label>
          </div>
          {!ordenarPorDistancia && (
            <p className="text-xs text-muted-foreground">
              Desmarcado: mantém a ordem em que os pontos foram escolhidos no mapa/lista.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={handleSalvar} disabled={!nome.trim() || salvando}>
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar rota
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
