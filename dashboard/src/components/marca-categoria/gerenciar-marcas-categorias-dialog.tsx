'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatarNumero } from '@/lib/formatters'
import { normalizarTexto, rotuloCategoria } from '@/lib/marca-categoria'
import type { CategoriaNuvemshop, MarcaNuvemshop } from '@/hooks/use-marca-categoria'
import { NovaCategoriaForm } from './nova-categoria-form'

interface Props {
  aberto: boolean
  onOpenChange: (aberto: boolean) => void
  marcas: MarcaNuvemshop[]
  categorias: CategoriaNuvemshop[]
  /** Uma marca ou categoria foi criada: recarregar as listas. */
  onAlterado: () => void
  /** Filtra a lista de produtos por esta marca/categoria e fecha o diálogo. */
  onFiltrarMarca: (marca: string) => void
  onFiltrarCategoria: (id: number) => void
}

/** Lista as marcas e categorias disponíveis (com quantos produtos usam cada uma) e permite criar novas. */
export function GerenciarMarcasCategoriasDialog({ aberto, onOpenChange, marcas, categorias, onAlterado, onFiltrarMarca, onFiltrarCategoria }: Props) {
  const [buscaMarca, setBuscaMarca] = useState('')
  const [buscaCategoria, setBuscaCategoria] = useState('')
  const [novaMarca, setNovaMarca] = useState('')
  const [criandoMarca, setCriandoMarca] = useState(false)

  const marcasFiltradas = useMemo(() => {
    const t = normalizarTexto(buscaMarca)
    return marcas.filter((m) => t === '' || normalizarTexto(m.nome).includes(t))
  }, [marcas, buscaMarca])
  const categoriasFiltradas = useMemo(() => {
    const t = normalizarTexto(buscaCategoria)
    return categorias.filter((c) => t === '' || normalizarTexto(c.caminho).includes(t))
  }, [categorias, buscaCategoria])
  const comGrafiaDuplicada = marcas.filter((m) => m.grafias_na_chave > 1).length

  const criarMarca = async () => {
    const nome = novaMarca.trim()
    if (!nome) return
    setCriandoMarca(true)
    try {
      const resp = await fetch('/api/marca-categoria/marcas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome }),
      })
      const corpo = await resp.json().catch(() => null)
      if (!resp.ok) throw new Error(corpo?.error || `Erro ${resp.status}`)
      if (typeof corpo?.nome !== 'string') throw new Error('Sessão expirada — entre novamente e repita.')
      toast.success(`Marca "${corpo.nome}" cadastrada. Ela passa a existir na Nuvemshop quando for atribuída a um produto.`)
      setNovaMarca('')
      onAlterado()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível cadastrar a marca.')
    } finally {
      setCriandoMarca(false)
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Marcas e categorias da loja</DialogTitle>
          <DialogDescription>
            Veja o que já existe na Nuvemshop e crie o que falta. Clique numa marca ou categoria para listar os produtos dela.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="marcas">
          <TabsList>
            <TabsTrigger value="marcas">Marcas ({formatarNumero(marcas.length)})</TabsTrigger>
            <TabsTrigger value="categorias">Categorias ({formatarNumero(categorias.length)})</TabsTrigger>
          </TabsList>

          <TabsContent value="marcas" className="flex flex-col gap-3 pt-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input placeholder="Nome da nova marca" value={novaMarca} maxLength={100} onChange={(e) => setNovaMarca(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && criarMarca()} disabled={criandoMarca} className="h-8 sm:w-64" />
              <Button size="sm" onClick={criarMarca} disabled={criandoMarca || novaMarca.trim() === ''}>
                {criandoMarca ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Cadastrar marca
              </Button>
              <p className="text-xs text-muted-foreground sm:ml-2">Na Nuvemshop a marca é um texto do produto: ela só passa a existir lá quando um produto a recebe.</p>
            </div>
            {comGrafiaDuplicada > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {comGrafiaDuplicada} grafia(s) repetida(s): a mesma marca escrita de jeitos diferentes (maiúscula/minúscula ou espaço no fim). Marcadas
                  abaixo — para padronizar, selecione os produtos e use &quot;Definir a marca&quot;.
                </span>
              </div>
            )}
            <Input placeholder="Buscar marca..." value={buscaMarca} onChange={(e) => setBuscaMarca(e.target.value)} className="h-8" />
            <div className="max-h-80 overflow-y-auto rounded-md border">
              {marcasFiltradas.map((m) => (
                <button
                  key={m.nome}
                  type="button"
                  onClick={() => {
                    onFiltrarMarca(m.nome)
                    onOpenChange(false)
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{m.nome !== m.nome.trim() ? `"${m.nome}"` : m.nome}</span>
                    {m.grafias_na_chave > 1 && <span className="shrink-0 rounded-4xl bg-amber-500/10 px-2 text-xs text-amber-700 dark:text-amber-400">grafia repetida</span>}
                    {m.criada_no_bi && m.qtd_produtos === 0 && <span className="shrink-0 rounded-4xl bg-sky-500/10 px-2 text-xs text-sky-700 dark:text-sky-400">nova, sem produtos</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatarNumero(m.qtd_produtos)} produto(s)</span>
                </button>
              ))}
              {marcasFiltradas.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">Nenhuma marca encontrada.</p>}
            </div>
          </TabsContent>

          <TabsContent value="categorias" className="flex flex-col gap-3 pt-2">
            <NovaCategoriaForm categorias={categorias} onCriada={onAlterado} />
            <Input placeholder="Buscar categoria..." value={buscaCategoria} onChange={(e) => setBuscaCategoria(e.target.value)} className="h-8" />
            <div className="max-h-80 overflow-y-auto rounded-md border">
              {categoriasFiltradas.map((c) => (
                <button
                  key={c.id_categoria}
                  type="button"
                  onClick={() => {
                    onFiltrarCategoria(c.id_categoria)
                    onOpenChange(false)
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                  title={c.caminho}
                >
                  <span className="truncate">{buscaCategoria ? c.caminho : rotuloCategoria(c)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatarNumero(c.qtd_produtos)} produto(s){c.qtd_subcategorias > 0 && ` · ${c.qtd_subcategorias} subcategoria(s)`}
                  </span>
                </button>
              ))}
              {categoriasFiltradas.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">Nenhuma categoria encontrada.</p>}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
