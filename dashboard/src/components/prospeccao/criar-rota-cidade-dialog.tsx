'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { cn } from 'cn'
import { geocodificarEndereco } from '@/lib/geocode'
import { ordenarPorProximidade } from '@/lib/distancia'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { useBuscaCidades, type CidadeBusca } from '@/hooks/use-cidades'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Cria a rota na hora com os leads já mapeados da cidade (já ordenados por proximidade). */
  onCriar: (nome: string, descricao: string | null, leadIds: number[], pontoPartidaEndereco: string | null) => Promise<void>
  /** O mapeamento em segundo plano começou (a rota já aparece na lista, "mapeando"). */
  onMapeamentoIniciado: () => void
}

function descreverCidade(c: CidadeBusca): string {
  if (c.mapeamento_status === 'pendente' || c.mapeamento_status === 'mapeando') return 'mapeando...'
  if (c.total_leads > 0) return `${c.total_leads} lead${c.total_leads === 1 ? '' : 's'}${c.mapeada_em ? ' · mapeada' : ''}`
  return 'ainda não mapeada'
}

export function CriarRotaCidadeDialog({ open, onOpenChange, onCriar, onMapeamentoIniciado }: Props) {
  const [nome, setNome] = useState('')
  const [cidade, setCidade] = useState<CidadeBusca | null>(null)
  const [pontoPartida, setPontoPartida] = useState('')
  const [completarMapeamento, setCompletarMapeamento] = useState(true)
  const [gerando, setGerando] = useState(false)

  const [seletorAberto, setSeletorAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const { cidades, loading: buscando } = useBuscaCidades(busca, open && seletorAberto)

  // Cidade sem nenhum lead (ou com o mapeamento completo pedido) -> busca no Google em segundo plano.
  const semLeads = !!cidade && cidade.total_leads === 0
  const mapeamentoCompletoPendente = !!cidade && cidade.total_leads > 0 && !cidade.mapeada_em
  const precisaMapear = semLeads || (mapeamentoCompletoPendente && completarMapeamento)
  const mapeandoAgora = cidade?.mapeamento_status === 'pendente' || cidade?.mapeamento_status === 'mapeando'

  const limpar = () => {
    setNome('')
    setCidade(null)
    setPontoPartida('')
    setBusca('')
    setCompletarMapeamento(true)
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

      if (precisaMapear) {
        const resposta = await fetch('/api/prospeccao/cidades/mapear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idIbge: cidade.id_ibge,
            nomeRota: nome.trim(),
            descricao: `Cidade: ${cidade.nome} - ${cidade.uf}`,
            pontoPartidaEndereco: geocode.nomeExibicao,
            pontoLat: geocode.lat,
            pontoLon: geocode.lon,
          }),
        })
        const dados = await resposta.json().catch(() => ({}))
        if (!resposta.ok) {
          toast.error(dados.error || 'Não foi possível iniciar o mapeamento.')
          return
        }
        toast.success(`Mapeando as barbearias de ${cidade.nome}. A rota será criada quando terminar.`)
        onMapeamentoIniciado()
        onOpenChange(false)
        limpar()
        return
      }

      // Cidade já mapeada: cria a rota na hora, na melhor ordem a partir do ponto de partida.
      const supabase = createClient()
      const { data, error } = await Promise.resolve(
        supabase.rpc('obter_leads_da_cidade', { p_schema_name: TENANT_SCHEMA, p_id_ibge: cidade.id_ibge })
      )
      if (error) throw error
      const leads = (data as { id: number; latitude: number; longitude: number }[]) ?? []
      if (leads.length === 0) {
        toast.error('Nenhum lead salvo nessa cidade.')
        return
      }
      const ordenados = ordenarPorProximidade({ lat: geocode.lat, lon: geocode.lon }, leads)
      await onCriar(nome.trim(), `Cidade: ${cidade.nome} - ${cidade.uf}`, ordenados.map((l) => l.id), geocode.nomeExibicao)
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
            Escolha qualquer cidade do Brasil. Se ela ainda não foi mapeada, buscamos todas as barbearias dela em
            segundo plano e a rota é criada quando terminar.
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
            <Popover open={seletorAberto} onOpenChange={setSeletorAberto}>
              <PopoverTrigger asChild>
                <Button
                  id="cidade-rota"
                  type="button"
                  variant="outline"
                  className="w-full justify-between font-normal"
                  aria-expanded={seletorAberto}
                >
                  <span className="truncate">{cidade ? `${cidade.nome} — ${cidade.uf}` : 'Selecione a cidade'}</span>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput placeholder="Buscar cidade ou UF (ex.: Londrina, PR)..." value={busca} onValueChange={setBusca} />
                  <CommandList>
                    {buscando && cidades.length === 0 ? (
                      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Buscando...
                      </div>
                    ) : (
                      <CommandEmpty>Nenhuma cidade encontrada.</CommandEmpty>
                    )}
                    <CommandGroup>
                      {cidades.map((c) => (
                        <CommandItem
                          key={c.id_ibge}
                          value={String(c.id_ibge)}
                          onSelect={() => {
                            setCidade(c)
                            setSeletorAberto(false)
                          }}
                        >
                          <Check className={cn('mr-2 h-4 w-4', cidade?.id_ibge === c.id_ibge ? 'opacity-100' : 'opacity-0')} />
                          <span className="truncate">
                            {c.nome} <span className="text-muted-foreground">— {c.uf}</span>
                          </span>
                          <span className="ml-auto pl-2 text-xs text-muted-foreground">{descreverCidade(c)}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {mapeandoAgora && (
              <p className="text-xs text-destructive">Essa cidade já está sendo mapeada. Aguarde terminar para criar outra rota.</p>
            )}
            {semLeads && !mapeandoAgora && (
              <p className="text-xs text-muted-foreground">
                Cidade ainda não mapeada. Ao gerar, vamos buscar todas as barbearias de {cidade.nome} no Google, em
                círculos que cobrem a cidade toda. Pode levar alguns minutos (cidades grandes, mais) e a rota aparece na
                lista como “Mapeando...” até ficar pronta.
              </p>
            )}
            {mapeamentoCompletoPendente && !mapeandoAgora && (
              <div className="flex items-start gap-2 rounded-md border p-3">
                <Checkbox
                  id="completar-mapeamento"
                  checked={completarMapeamento}
                  onCheckedChange={(v) => setCompletarMapeamento(v === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="completar-mapeamento" className="flex flex-col items-start gap-1 text-sm font-normal">
                  <span>Completar o mapeamento da cidade antes</span>
                  <span className="text-xs text-muted-foreground">
                    Hoje há {cidade.total_leads} lead(s) salvos de buscas anteriores. Marcado: buscamos todas as
                    barbearias da cidade em segundo plano e a rota é criada ao terminar. Desmarcado: a rota sai agora só
                    com os leads atuais.
                  </span>
                </Label>
              </div>
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
          <Button
            onClick={handleGerar}
            disabled={!nome.trim() || !cidade || !pontoPartida.trim() || gerando || mapeandoAgora}
          >
            {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {gerando ? 'Gerando...' : precisaMapear ? 'Mapear e gerar rota' : 'Gerar rota'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
