'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Download, X, Tags } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MarcaCategoriaTabela } from '@/components/marca-categoria/marca-categoria-tabela'
import { AplicarEmMassaDialog } from '@/components/marca-categoria/aplicar-em-massa-dialog'
import { GerenciarMarcasCategoriasDialog } from '@/components/marca-categoria/gerenciar-marcas-categorias-dialog'
import type { ResultadoMarcaCategoria } from '@/app/api/marca-categoria/alterar/route'
import {
  buscarTodosProdutosMarcaCategoria,
  useCategoriasNuvemshop,
  useMarcasNuvemshop,
  useProdutosMarcaCategoria,
  useResumoMarcaCategoria,
  type FiltroMarcaCategoria,
  type OrdenarMarcaCategoriaPor,
  type ProdutoMarcaCategoria,
} from '@/hooks/use-marca-categoria'
import { cn } from 'cn'
import { formatarNumero } from '@/lib/formatters'
import { marcasUnicas, rotuloCategoria } from '@/lib/marca-categoria'

const TAMANHO_PAGINA = 50
const TODAS = '__todas__'

const OPCOES_FILTRO: { value: FiltroMarcaCategoria; label: string }[] = [
  { value: 'todos', label: 'Todos os produtos' },
  { value: 'sem_marca', label: 'Sem marca' },
  { value: 'sem_categoria', label: 'Sem categoria' },
  { value: 'sem_marca_ou_categoria', label: 'Sem marca ou sem categoria' },
  { value: 'completos', label: 'Com marca e categoria' },
]

/** CSV em pt-BR/Excel: separador ";" e BOM pra acentuar certo. */
function gerarCsv(produtos: ProdutoMarcaCategoria[]): string {
  const cabecalho = ['Produto Nuvemshop', 'SKU (exemplo)', 'Variantes', 'Publicado', 'Marca', 'Categorias', 'Link na loja']
  const celula = (v: string | number | boolean | null) => {
    if (v === null || v === undefined) return ''
    const t = typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v)
    return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const corpo = produtos.map((p) =>
    [p.nome, p.sku_exemplo, p.qtd_variantes, p.publicado, p.marca, p.categorias.map((c) => c.caminho).join(' | '), p.url].map(celula).join(';')
  )
  return '﻿' + [cabecalho.join(';'), ...corpo].join('\r\n')
}

export default function MarcaCategoriaPage() {
  const [filtro, setFiltro] = useState<FiltroMarcaCategoria>('sem_marca_ou_categoria')
  const [busca, setBusca] = useState('')
  const [marca, setMarca] = useState('')
  const [categoriaId, setCategoriaId] = useState<number | null>(null)
  const [apenasPublicados, setApenasPublicados] = useState(true)
  const [ordenarPor, setOrdenarPor] = useState<OrdenarMarcaCategoriaPor>('nome')
  const [ordenarDirecao, setOrdenarDirecao] = useState<'asc' | 'desc'>('asc')
  const [pagina, setPagina] = useState(1)
  const [gatilho, setGatilho] = useState(0)
  const [gatilhoListas, setGatilhoListas] = useState(0)

  const [selecionados, setSelecionados] = useState<Map<number, ProdutoMarcaCategoria>>(new Map())
  const [erros, setErros] = useState<Map<number, string>>(new Map())
  const [selecionandoTodos, setSelecionandoTodos] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [aplicarAberto, setAplicarAberto] = useState(false)
  const [gerenciarAberto, setGerenciarAberto] = useState(false)

  const { linhas, totalRegistros, loading, error } = useProdutosMarcaCategoria(
    { filtro, busca, marca, categoriaId, apenasPublicados, ordenarPor, ordenarDirecao, pagina, tamanhoPagina: TAMANHO_PAGINA },
    gatilho
  )
  const resumo = useResumoMarcaCategoria(apenasPublicados, gatilho)
  const marcasBrutas = useMarcasNuvemshop(gatilhoListas)
  const categorias = useCategoriasNuvemshop(gatilhoListas)
  const marcasParaFiltro = useMemo(() => marcasUnicas(marcasBrutas), [marcasBrutas])

  const comReset = <T,>(setter: (v: T) => void) => (v: T) => {
    setPagina(1)
    setter(v)
  }

  const handleOrdenarChange = (coluna: OrdenarMarcaCategoriaPor) => {
    setPagina(1)
    if (coluna === ordenarPor) setOrdenarDirecao((d) => (d === 'desc' ? 'asc' : 'desc'))
    else {
      setOrdenarPor(coluna)
      setOrdenarDirecao('asc')
    }
  }

  const atualizarSelecao = (fn: (m: Map<number, ProdutoMarcaCategoria>) => void) =>
    setSelecionados((atual) => {
      const nova = new Map(atual)
      fn(nova)
      return nova
    })

  const handleToggle = (p: ProdutoMarcaCategoria) =>
    atualizarSelecao((m) => {
      if (m.has(p.id_produto_ns)) m.delete(p.id_produto_ns)
      else m.set(p.id_produto_ns, p)
    })

  const handleToggleTodosPagina = (marcar: boolean) =>
    atualizarSelecao((m) => {
      for (const p of linhas) {
        if (marcar) m.set(p.id_produto_ns, p)
        else m.delete(p.id_produto_ns)
      }
    })

  /** Seleciona TODOS os produtos do filtro atual (todas as páginas). */
  const handleSelecionarTodosDoFiltro = async () => {
    setSelecionandoTodos(true)
    try {
      const todos = await buscarTodosProdutosMarcaCategoria({ filtro, busca, marca, categoriaId, apenasPublicados, ordenarPor, ordenarDirecao })
      atualizarSelecao((m) => {
        for (const p of todos) m.set(p.id_produto_ns, p)
      })
      toast.success(`${formatarNumero(todos.length)} produto(s) selecionado(s).`)
    } catch (e) {
      console.error('Erro ao selecionar os produtos do filtro:', e)
      toast.error('Não foi possível selecionar. Tente de novo.')
    } finally {
      setSelecionandoTodos(false)
    }
  }

  const handleAtualizar = () => {
    setGatilho((g) => g + 1)
    setGatilhoListas((g) => g + 1)
  }

  const handleAplicado = (resultados: ResultadoMarcaCategoria[]) => {
    // Sucesso sai da seleção; falha fica selecionada com a mensagem na linha.
    atualizarSelecao((m) => {
      for (const r of resultados) if (r.sucesso) m.delete(r.id_produto_ns)
    })
    setErros((atual) => {
      const novo = new Map(atual)
      for (const r of resultados) {
        if (r.sucesso) novo.delete(r.id_produto_ns)
        else novo.set(r.id_produto_ns, r.erro ?? 'Erro')
      }
      return novo
    })
    handleAtualizar()
  }

  const handleExportar = async () => {
    setExportando(true)
    try {
      const todos = await buscarTodosProdutosMarcaCategoria({ filtro, busca, marca, categoriaId, apenasPublicados, ordenarPor, ordenarDirecao })
      const url = URL.createObjectURL(new Blob([gerarCsv(todos)], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `marca-categoria-nuvemshop-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`${formatarNumero(todos.length)} produto(s) exportado(s).`)
    } catch (e) {
      console.error('Erro ao exportar marca e categoria:', e)
      toast.error('Não foi possível exportar. Tente de novo.')
    } finally {
      setExportando(false)
    }
  }

  const produtosSelecionados = useMemo(() => [...selecionados.values()], [selecionados])
  const faltaAlgo = resumo ? resumo.sem_marca + resumo.sem_categoria - resumo.sem_ambos : 0
  const cartoes: { chave: FiltroMarcaCategoria; label: string; valor: number | null }[] = [
    { chave: 'todos', label: 'Produtos na Nuvemshop', valor: resumo?.total ?? null },
    { chave: 'sem_marca', label: 'Sem marca', valor: resumo?.sem_marca ?? null },
    { chave: 'sem_categoria', label: 'Sem categoria', valor: resumo?.sem_categoria ?? null },
    { chave: 'sem_marca_ou_categoria', label: 'Sem marca ou categoria', valor: resumo ? faltaAlgo : null },
    { chave: 'completos', label: 'Com marca e categoria', valor: resumo?.completos ?? null },
  ]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Conferência de Marca e Categoria</h1>
            <p className="text-sm text-muted-foreground">
              Marca e categorias de cada produto da Nuvemshop. Filtre o que está sem marca ou sem categoria e grave em massa — a
              alteração vale na loja na hora (só marca e categoria; o resto do produto não muda).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setGerenciarAberto(true)}>
              <Tags className="h-4 w-4" />
              Marcas e categorias
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportar} disabled={exportando || loading || totalRegistros === 0}>
              <Download className={cn('h-4 w-4', exportando && 'animate-pulse')} />
              Exportar CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleAtualizar} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {cartoes.map((c) => (
            <button
              key={c.chave}
              type="button"
              onClick={() => comReset(setFiltro)(c.chave)}
              className={cn('rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50', filtro === c.chave && 'border-foreground/60 ring-1 ring-foreground/20')}
            >
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{c.valor === null ? '—' : formatarNumero(c.valor)}</p>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Input placeholder="Buscar por nome ou SKU..." value={busca} onChange={(e) => comReset(setBusca)(e.target.value)} className="h-8 w-full sm:w-72" />
          <Select value={filtro} onValueChange={(v) => comReset(setFiltro)(v as FiltroMarcaCategoria)}>
            <SelectTrigger className="w-64" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPCOES_FILTRO.map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={marca === '' ? TODAS : marca} onValueChange={(v) => comReset(setMarca)(v === TODAS ? '' : v)}>
            <SelectTrigger className="w-56" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={TODAS}>Todas as marcas</SelectItem>
              {marcasParaFiltro.map((m) => (
                <SelectItem key={m.nome} value={m.nome}>
                  {m.nome} ({formatarNumero(m.qtd_produtos)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoriaId === null ? TODAS : String(categoriaId)} onValueChange={(v) => comReset(setCategoriaId)(v === TODAS ? null : Number(v))}>
            <SelectTrigger className="w-72" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={TODAS}>Todas as categorias</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c.id_categoria} value={String(c.id_categoria)}>
                  {rotuloCategoria(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={apenasPublicados} onCheckedChange={(v) => comReset(setApenasPublicados)(v === true)} />
            Só produtos publicados
          </label>
        </div>
      </div>

      {selecionados.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-col gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">{formatarNumero(selecionados.size)} produto(s) selecionado(s)</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSelecionarTodosDoFiltro} disabled={selecionandoTodos || totalRegistros === 0}>
              Selecionar os {formatarNumero(totalRegistros)} do filtro
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelecionados(new Map())}>
              <X className="h-4 w-4" />
              Limpar seleção
            </Button>
            <Button size="sm" onClick={() => setAplicarAberto(true)}>
              Aplicar marca / categoria…
            </Button>
          </div>
        </div>
      )}
      {selecionados.size === 0 && totalRegistros > 0 && !loading && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSelecionarTodosDoFiltro} disabled={selecionandoTodos}>
            Selecionar os {formatarNumero(totalRegistros)} produtos do filtro
          </Button>
        </div>
      )}

      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}

      <MarcaCategoriaTabela
        linhas={linhas}
        totalRegistros={totalRegistros}
        loading={loading}
        ordenarPor={ordenarPor}
        ordenarDirecao={ordenarDirecao}
        onOrdenarChange={handleOrdenarChange}
        pagina={pagina}
        tamanhoPagina={TAMANHO_PAGINA}
        onPaginaChange={setPagina}
        selecionados={selecionados}
        onToggle={handleToggle}
        onToggleTodosPagina={handleToggleTodosPagina}
        erros={erros}
        desabilitado={aplicarAberto}
      />

      <AplicarEmMassaDialog
        aberto={aplicarAberto}
        onOpenChange={setAplicarAberto}
        produtos={produtosSelecionados}
        marcas={marcasBrutas}
        categorias={categorias}
        onCategoriaCriada={() => setGatilhoListas((g) => g + 1)}
        onAplicado={handleAplicado}
      />

      <GerenciarMarcasCategoriasDialog
        aberto={gerenciarAberto}
        onOpenChange={setGerenciarAberto}
        marcas={marcasBrutas}
        categorias={categorias}
        onAlterado={() => setGatilhoListas((g) => g + 1)}
        onFiltrarMarca={(m) => {
          comReset(setMarca)(m)
          setFiltro('todos')
        }}
        onFiltrarCategoria={(id) => {
          comReset(setCategoriaId)(id)
          setFiltro('todos')
        }}
      />
    </div>
  )
}
