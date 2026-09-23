'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { geocodificarEndereco } from '@/lib/geocode'
import { ordenarPorProximidade } from '@/lib/distancia'
import type { LeadMapeado } from '@/hooks/use-leads-mapeados'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  leads: LeadMapeado[]
  onCriar: (nome: string, descricao: string | null, leadIds: number[], pontoPartidaEndereco: string | null) => Promise<void>
}

export function CriarRotaCidadeDialog({ open, onOpenChange, leads, onCriar }: Props) {
  const [nome, setNome] = useState('')
  const [cidade, setCidade] = useState('')
  const [pontoPartida, setPontoPartida] = useState('')
  const [gerando, setGerando] = useState(false)

  const cidades = useMemo(() => {
    const contagem = new Map<string, number>()
    for (const l of leads) {
      if (!l.cidade) continue
      contagem.set(l.cidade, (contagem.get(l.cidade) ?? 0) + 1)
    }
    return Array.from(contagem.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
      .map(([nomeCidade, total]) => ({ nomeCidade, total }))
  }, [leads])

  const limpar = () => {
    setNome('')
    setCidade('')
    setPontoPartida('')
  }

  const handleGerar = async () => {
    if (!nome.trim() || !cidade || !pontoPartida.trim()) return
    setGerando(true)
    try {
      const geocode = await geocodificarEndereco(pontoPartida)
      if (!geocode) {
        toast.error('Não foi possível localizar esse endereço de partida.')
        return
      }

      const leadsDaCidade = leads.filter((l) => l.cidade === cidade)
      if (leadsDaCidade.length === 0) {
        toast.error('Nenhum lead salvo nessa cidade.')
        return
      }

      const ordenados = ordenarPorProximidade({ lat: geocode.lat, lon: geocode.lon }, leadsDaCidade)
      await onCriar(nome.trim(), `Cidade: ${cidade}`, ordenados.map((l) => l.id), geocode.nomeExibicao)
      onOpenChange(false)
      limpar()
    } catch (err) {
      console.error('Erro ao gerar rota por cidade:', err)
      toast.error('Não foi possível gerar a rota.')
    } finally {
      setGerando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar rota por cidade</DialogTitle>
          <DialogDescription>
            Gera automaticamente a sequência de visita mais eficiente entre todos os leads salvos na cidade escolhida,
            a partir do ponto de partida informado.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nome-rota-cidade">Nome da rota</Label>
            <Input
              id="nome-rota-cidade"
              placeholder="ex.: Rota Maringá — semana 1"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cidade-rota">Cidade</Label>
            <Select value={cidade} onValueChange={setCidade}>
              <SelectTrigger id="cidade-rota" className="w-full">
                <SelectValue placeholder="Selecione a cidade" />
              </SelectTrigger>
              <SelectContent>
                {cidades.map((c) => (
                  <SelectItem key={c.nomeCidade} value={c.nomeCidade}>
                    {c.nomeCidade} ({c.total})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cidades.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nenhum lead com cidade gravada ainda — mapeie leads no Mapeamento de Leads primeiro.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ponto-partida-rota">Ponto de partida (endereço inicial)</Label>
            <Input
              id="ponto-partida-rota"
              placeholder="ex.: Av. Brasil, 1000, Maringá, PR"
              value={pontoPartida}
              onChange={(e) => setPontoPartida(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={gerando}>
            Cancelar
          </Button>
          <Button onClick={handleGerar} disabled={!nome.trim() || !cidade || !pontoPartida.trim() || gerando}>
            {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {gerando ? 'Gerando...' : 'Gerar rota'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
