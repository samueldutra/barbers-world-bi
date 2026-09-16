'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, ExternalLink, Loader2, MapPin, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { montarUrlRota } from '@/lib/google-maps-route'
import { formatarDataHora } from '@/lib/formatters'
import type { RotaVisita, ParadaRota, StatusRota } from '@/hooks/use-rotas-visita'

const LABEL_STATUS_ROTA: Record<StatusRota, string> = {
  planejada: 'Planejada',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
}

const VARIANTE_STATUS_ROTA: Record<StatusRota, 'default' | 'secondary' | 'outline'> = {
  planejada: 'outline',
  em_andamento: 'secondary',
  concluida: 'default',
  cancelada: 'outline',
}

interface Props {
  rotas: RotaVisita[]
  loading: boolean
  centro: { lat: number; lon: number }
  onCarregarParadas: (rotaId: number) => Promise<ParadaRota[]>
  onAtualizarStatusRota: (id: number, status: StatusRota) => Promise<void>
  onAtualizarParada: (paradaId: number, visitaRealizada: boolean) => Promise<void>
  onExcluirRota: (id: number) => Promise<void>
}

export function RotasSalvasLista({
  rotas,
  loading,
  centro,
  onCarregarParadas,
  onAtualizarStatusRota,
  onAtualizarParada,
  onExcluirRota,
}: Props) {
  const [expandida, setExpandida] = useState<number | null>(null)
  const [paradasPorRota, setParadasPorRota] = useState<Record<number, ParadaRota[]>>({})
  const [carregandoParadas, setCarregandoParadas] = useState<Set<number>>(new Set())

  const toggleExpandir = async (rotaId: number) => {
    if (expandida === rotaId) {
      setExpandida(null)
      return
    }
    setExpandida(rotaId)
    if (paradasPorRota[rotaId]) return
    setCarregandoParadas((atual) => new Set(atual).add(rotaId))
    try {
      const paradas = await onCarregarParadas(rotaId)
      setParadasPorRota((atual) => ({ ...atual, [rotaId]: paradas }))
    } catch (err) {
      console.error('Erro ao carregar paradas da rota:', err)
      toast.error('Não foi possível carregar as paradas dessa rota.')
    } finally {
      setCarregandoParadas((atual) => {
        const novo = new Set(atual)
        novo.delete(rotaId)
        return novo
      })
    }
  }

  const recarregarParadas = async (rotaId: number) => {
    const paradas = await onCarregarParadas(rotaId)
    setParadasPorRota((atual) => ({ ...atual, [rotaId]: paradas }))
  }

  const handleToggleParada = async (rotaId: number, parada: ParadaRota) => {
    try {
      await onAtualizarParada(parada.parada_id, !parada.visita_realizada)
      await recarregarParadas(rotaId)
    } catch (err) {
      console.error('Erro ao atualizar parada:', err)
      toast.error('Não foi possível atualizar essa parada.')
    }
  }

  const handleExcluir = async (id: number) => {
    try {
      await onExcluirRota(id)
      toast.success('Rota removida.')
    } catch (err) {
      console.error('Erro ao excluir rota:', err)
      toast.error('Não foi possível remover essa rota.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rotas salvas</CardTitle>
        <CardDescription>{rotas.length} rota(s) — acompanhe o progresso e marque as visitas realizadas</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
        ) : rotas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma rota salva ainda. Selecione leads no mapa ou na lista acima e clique em &quot;Salvar rota&quot;.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rotas.map((rota) => {
              const aberta = expandida === rota.id
              const paradas = paradasPorRota[rota.id]
              const carregando = carregandoParadas.has(rota.id)
              return (
                <li key={rota.id} className="flex flex-col py-3">
                  <div className="flex items-center gap-3">
                    <Button size="icon" variant="ghost" onClick={() => toggleExpandir(rota.id)}>
                      {aberta ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{rota.nome}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {rota.paradas_visitadas}/{rota.total_paradas} visitada(s) · criada em {formatarDataHora(rota.criado_em)}
                        {rota.descricao ? ` · ${rota.descricao}` : ''}
                      </p>
                    </div>
                    <Badge variant={VARIANTE_STATUS_ROTA[rota.status]}>{LABEL_STATUS_ROTA[rota.status]}</Badge>
                    <Select
                      value={rota.status}
                      onValueChange={(v) => onAtualizarStatusRota(rota.id, v as StatusRota)}
                    >
                      <SelectTrigger className="w-36" size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="planejada">Planejada</SelectItem>
                        <SelectItem value="em_andamento">Em andamento</SelectItem>
                        <SelectItem value="concluida">Concluída</SelectItem>
                        <SelectItem value="cancelada">Cancelada</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleExcluir(rota.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {aberta && (
                    <div className="ml-10 mt-3 flex flex-col gap-2 rounded-md border p-3">
                      {carregando ? (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" /> Carregando paradas...
                        </p>
                      ) : !paradas || paradas.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Essa rota não tem paradas.</p>
                      ) : (
                        <>
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => window.open(montarUrlRota(centro, paradas), '_blank')}
                            >
                              <ExternalLink className="h-4 w-4" />
                              Abrir no Google Maps
                            </Button>
                          </div>
                          <ul className="flex flex-col divide-y divide-border">
                            {paradas.map((parada, i) => (
                              <li key={parada.parada_id} className="flex items-center gap-3 py-2">
                                <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">{i + 1}</span>
                                <Checkbox
                                  checked={parada.visita_realizada}
                                  onCheckedChange={() => handleToggleParada(rota.id, parada)}
                                />
                                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                  <p className={`truncate text-sm ${parada.visita_realizada ? 'text-muted-foreground line-through' : ''}`}>
                                    {parada.nome}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {[parada.endereco, parada.telefone].filter(Boolean).join(' · ') || 'Sem endereço/telefone'}
                                  </p>
                                </div>
                                {parada.visita_realizada && parada.visitado_em && (
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    Visitado em {formatarDataHora(parada.visitado_em)}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
