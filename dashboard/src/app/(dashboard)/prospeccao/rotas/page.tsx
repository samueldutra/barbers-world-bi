'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Building2, MousePointerClick, Plus, Route } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { RotaCard } from '@/components/prospeccao/rotas/rota-card'
import { CriarRotaCidadeDialog } from '@/components/prospeccao/criar-rota-cidade-dialog'
import { useRotasVisita, type StatusRota } from '@/hooks/use-rotas-visita'
import { useLeadsMapeados } from '@/hooks/use-leads-mapeados'

type FiltroRotas = 'ativas' | 'concluida' | 'cancelada' | 'todas'

const FILTROS: { value: FiltroRotas; label: string; status: StatusRota[] | null }[] = [
  { value: 'ativas', label: 'Ativas', status: ['planejada', 'em_andamento'] },
  { value: 'concluida', label: 'Concluídas', status: ['concluida'] },
  { value: 'cancelada', label: 'Canceladas', status: ['cancelada'] },
  { value: 'todas', label: 'Todas', status: null },
]

/** Listagem de rotas de visita. Cada rota abre em /prospeccao/rotas/[id]; montar uma rota
 * nova escolhendo paradas fica em /prospeccao/rotas/nova. */
export default function RotasPage() {
  const router = useRouter()
  const [filtro, setFiltro] = useState<FiltroRotas>('ativas')
  const [dialogCidadeAberto, setDialogCidadeAberto] = useState(false)

  const { rotas, loading, error, salvar, atualizarStatus, excluir } = useRotasVisita()
  const { leads } = useLeadsMapeados()

  const contagem = useMemo(() => {
    const c: Record<FiltroRotas, number> = { ativas: 0, concluida: 0, cancelada: 0, todas: rotas.length }
    for (const r of rotas) {
      if (r.status === 'planejada' || r.status === 'em_andamento') c.ativas++
      else c[r.status]++
    }
    return c
  }, [rotas])

  const rotasFiltradas = useMemo(() => {
    const status = FILTROS.find((f) => f.value === filtro)?.status
    return status ? rotas.filter((r) => status.includes(r.status)) : rotas
  }, [rotas, filtro])

  const handleAlterarStatus = async (id: number, status: StatusRota) => {
    try {
      await atualizarStatus(id, status)
    } catch (err) {
      console.error('Erro ao atualizar status da rota:', err)
      toast.error('Não foi possível atualizar o status da rota.')
    }
  }

  const handleExcluir = async (id: number) => {
    try {
      await excluir(id)
      toast.success('Rota removida.')
    } catch (err) {
      console.error('Erro ao excluir rota:', err)
      toast.error('Não foi possível remover essa rota.')
      throw err
    }
  }

  const handleCriarPorCidade = async (
    nome: string,
    descricao: string | null,
    leadIds: number[],
    pontoPartidaEndereco: string | null
  ) => {
    try {
      const id = await salvar(nome, leadIds, descricao, pontoPartidaEndereco)
      toast.success(`Rota "${nome}" criada com ${leadIds.length} parada(s).`)
      router.push(`/prospeccao/rotas/${id}`)
    } catch (err) {
      console.error('Erro ao salvar rota:', err)
      toast.error('Não foi possível salvar essa rota.')
      throw err
    }
  }

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Rotas de visita</h1>
          <p className="text-sm text-muted-foreground">Abra uma rota para acompanhar as paradas e navegar até cada lead</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="w-full sm:w-auto">
              <Plus className="h-4 w-4" />
              Nova rota
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem asChild>
              <Link href="/prospeccao/rotas/nova" className="flex flex-col items-start gap-0.5">
                <span className="flex items-center gap-2 font-medium">
                  <MousePointerClick className="h-4 w-4" />
                  Escolher paradas no mapa
                </span>
                <span className="pl-6 text-xs text-muted-foreground">Você define os leads e a ordem</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialogCidadeAberto(true)} className="flex flex-col items-start gap-0.5">
              <span className="flex items-center gap-2 font-medium">
                <Building2 className="h-4 w-4" />
                Gerar por cidade
              </span>
              <span className="pl-6 text-xs text-muted-foreground">Todos os leads da cidade, na melhor ordem</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Filtro rolável na horizontal no celular, sem quebrar linha. */}
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filtro}
          onValueChange={(v) => v && setFiltro(v as FiltroRotas)}
          className="w-max"
        >
          {FILTROS.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value} className="px-3">
              {f.label}
              <span className="ml-1 text-xs tabular-nums text-muted-foreground">{contagem[f.value]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : rotasFiltradas.length === 0 ? (
        <Card className="items-center gap-3 px-6 py-12 text-center">
          <Route className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {rotas.length === 0 ? 'Nenhuma rota criada ainda.' : 'Nenhuma rota neste filtro.'}
          </p>
          {rotas.length === 0 && (
            <Button asChild variant="outline" size="sm">
              <Link href="/prospeccao/rotas/nova">Montar a primeira rota</Link>
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-3 animate-in fade-in-0 duration-300 sm:grid-cols-2 xl:grid-cols-3">
          {rotasFiltradas.map((rota) => (
            <RotaCard
              key={rota.id}
              rota={rota}
              onAlterarStatus={(s) => handleAlterarStatus(rota.id, s)}
              onExcluir={() => handleExcluir(rota.id)}
            />
          ))}
        </div>
      )}

      <CriarRotaCidadeDialog
        open={dialogCidadeAberto}
        onOpenChange={setDialogCidadeAberto}
        leads={leads}
        onCriar={handleCriarPorCidade}
      />
    </div>
  )
}
