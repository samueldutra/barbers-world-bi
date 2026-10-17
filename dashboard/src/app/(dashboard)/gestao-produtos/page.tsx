'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CatalogoTabela } from '@/components/gestao-produtos/catalogo-tabela'
import { useFiltrosProdutos } from '@/hooks/use-filtros-produtos'
import {
  buscarCatalogoCompleto,
  useCatalogoProdutos,
  useResumoCatalogo,
  type FiltroCatalogo,
  type FiltrosCatalogo,
  type OrdenarCatalogoPor,
  type ProdutoCatalogo,
  type ResumoCatalogo,
} from '@/hooks/use-gestao-produtos'
import { cn } from 'cn'
import { formatarNumero } from '@/lib/formatters'
import { exportarCSV, exportarXLSX, type ColunaExportavel } from '@/lib/export'

/** Atualização automática dos dados (sem botão de atualizar): a cada 10 minutos. */
const INTERVALO_ATUALIZACAO_MS = 10 * 60 * 1000
const TAMANHO_PAGINA = 50
const TODAS = '__todas__'

const CARTOES: { filtro: FiltroCatalogo; rotulo: string; campo: keyof ResumoCatalogo; alerta?: boolean }[] = [
  { filtro: 'todos', rotulo: 'Produtos ativos', campo: 'total' },
  { filtro: 'sem_estoque', rotulo: 'Sem estoque', campo: 'sem_estoque', alerta: true },
  { filtro: 'sem_nuvemshop', rotulo: 'Fora da Nuvemshop', campo: 'sem_nuvemshop', alerta: true },
  { filtro: 'nuvemshop_despublicado', rotulo: 'Despublicados na loja', campo: 'nuvemshop_despublicado', alerta: true },
  { filtro: 'sem_custo', rotulo: 'Sem custo', campo: 'sem_custo', alerta: true },
  { filtro: 'sem_codigo', rotulo: 'Sem SKU', campo: 'sem_codigo', alerta: true },
  { filtro: 'sem_marca', rotulo: 'Sem marca', campo: 'sem_marca', alerta: true },
  { filtro: 'sem_categoria', rotulo: 'Sem categoria', campo: 'sem_categoria', alerta: true },
  { filtro: 'preco_alterado', rotulo: 'Preço alterado (7 dias)', campo: 'preco_alterado' },
]

const COLUNAS_EXPORTACAO: ColunaExportavel<ProdutoCatalogo>[] = [
  { cabecalho: 'Código', valor: (p) => p.codigo || '', largura: 18 },
  { cabecalho: 'Produto', valor: (p) => p.nome || 'Produto sem nome', largura: 42 },
  { cabecalho: 'Marca', valor: (p) => p.marca || 'Sem marca', largura: 18 },
  { cabecalho: 'Categoria', valor: (p) => p.categoria_descricao || 'Sem categoria', largura: 22 },
  { cabecalho: 'Preço (R$)', valor: (p) => Number(p.preco ?? 0), largura: 14, formatoNumerico: '#,##0.00' },
  { cabecalho: 'Custo (R$)', valor: (p) => (p.preco_custo == null ? '' : Number(p.preco_custo)), largura: 14, formatoNumerico: '#,##0.00' },
  { cabecalho: 'Margem bruta (R$)', valor: (p) => (p.margem_valor == null ? '' : Number(p.margem_valor)), largura: 18, formatoNumerico: '#,##0.00' },
  { cabecalho: 'Margem bruta (%)', valor: (p) => (p.margem_pct == null ? '' : Number(p.margem_pct)), largura: 16, formatoNumerico: '0.00' },
  { cabecalho: 'Estoque (Bling)', valor: (p) => (p.saldo_virtual == null ? '' : Number(p.saldo_virtual)), largura: 14 },
  {
    cabecalho: 'Nuvemshop',
    valor: (p) => (p.ns_variantes === 0 ? 'Fora da loja' : p.ns_publicado ? 'Publicado' : 'Despublicado'),
    largura: 16,
  },
]

export default function GestaoProdutosPage() {
  const [filtro, setFiltro] = useState<FiltroCatalogo>('todos')
  const [busca, setBusca] = useState('')
  const [marca, setMarca] = useState<string | null>(null)
  const [categoria, setCategoria] = useState<string | null>(null)
  const [apenasComEstoque, setApenasComEstoque] = useState(true)
  const [ordenarPor, setOrdenarPor] = useState<OrdenarCatalogoPor>('nome')
  const [ordenarDirecao, setOrdenarDirecao] = useState<'asc' | 'desc'>('asc')
  const [pagina, setPagina] = useState(1)
  const [exportando, setExportando] = useState(false)

  const [refreshToken, setRefreshToken] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setRefreshToken((t) => t + 1), INTERVALO_ATUALIZACAO_MS)
    return () => clearInterval(id)
  }, [])

  const filtros: FiltrosCatalogo = { filtro, busca, marca, categoria, apenasComEstoque, ordenarPor, ordenarDirecao, pagina, tamanhoPagina: TAMANHO_PAGINA }
  const { linhas, totalRegistros, loading, error } = useCatalogoProdutos(filtros, refreshToken)
  const resumo = useResumoCatalogo(apenasComEstoque, refreshToken)
  const { marcas, categorias } = useFiltrosProdutos()

  const handleOrdenarChange = (coluna: OrdenarCatalogoPor) => {
    setPagina(1)
    if (coluna === ordenarPor) {
      setOrdenarDirecao((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setOrdenarPor(coluna)
      setOrdenarDirecao('asc')
    }
  }

  const handleExportar = async (formato: 'csv' | 'xlsx') => {
    setExportando(true)
    try {
      const todos = await buscarCatalogoCompleto(filtros, totalRegistros)
      const nomeBase = `gestao-de-produtos_${new Date().toISOString().slice(0, 10)}`
      if (formato === 'csv') {
        exportarCSV(todos, COLUNAS_EXPORTACAO, `${nomeBase}.csv`)
      } else {
        await exportarXLSX(todos, COLUNAS_EXPORTACAO, `${nomeBase}.xlsx`, 'Gestão de produtos')
      }
      toast.success(`Exportação concluída: ${todos.length} produtos.`)
    } catch (err) {
      console.error('Erro ao exportar a gestão de produtos:', err)
      toast.error('Não foi possível exportar.')
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Gestão de Produtos</h1>
        <p className="text-sm text-muted-foreground">
          Catálogo dos produtos ativos do Bling com custo, margem bruta, estoque e situação na Nuvemshop (cruzada pelo SKU)
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {CARTOES.map((c) => {
          const valor = resumo ? resumo[c.campo] : null
          const selecionado = filtro === c.filtro
          return (
            <button
              key={c.filtro}
              type="button"
              onClick={() => {
                setPagina(1)
                setFiltro(c.filtro)
                // "Sem estoque" é o oposto do filtro padrão: desmarca pra não zerar a lista.
                if (c.filtro === 'sem_estoque') setApenasComEstoque(false)
              }}
              className={cn(
                'rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50',
                selecionado && 'border-foreground ring-1 ring-foreground'
              )}
            >
              <p className="text-xs text-muted-foreground">{c.rotulo}</p>
              <p className={cn('text-2xl font-semibold tabular-nums', c.alerta && valor ? 'text-amber-600' : undefined)}>
                {valor == null ? '—' : formatarNumero(valor)}
              </p>
            </button>
          )
        })}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>Catálogo</CardTitle>
            <CardDescription>Clique num cartão acima para filtrar por situação</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Buscar por nome ou SKU..."
              value={busca}
              onChange={(e) => {
                setPagina(1)
                setBusca(e.target.value)
              }}
              className="w-full sm:w-64"
            />
            <Select
              value={marca ?? TODAS}
              onValueChange={(v) => {
                setPagina(1)
                setMarca(v === TODAS ? null : v)
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Marca" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas as marcas</SelectItem>
                {marcas.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={categoria ?? TODAS}
              onValueChange={(v) => {
                setPagina(1)
                setCategoria(v === TODAS ? null : v)
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas as categorias</SelectItem>
                {categorias.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Checkbox
                id="apenas-com-estoque"
                checked={apenasComEstoque}
                onCheckedChange={(v) => {
                  setPagina(1)
                  setApenasComEstoque(v === true)
                }}
              />
              <Label htmlFor="apenas-com-estoque" className="cursor-pointer text-sm font-normal">
                Apenas com estoque
              </Label>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={exportando || totalRegistros === 0}>
                  {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExportar('csv')}>Exportar CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportar('xlsx')}>Exportar XLSX</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent>
          <CatalogoTabela
            linhas={linhas}
            totalRegistros={totalRegistros}
            loading={loading}
            ordenarPor={ordenarPor}
            ordenarDirecao={ordenarDirecao}
            onOrdenarChange={handleOrdenarChange}
            pagina={pagina}
            tamanhoPagina={TAMANHO_PAGINA}
            onPaginaChange={setPagina}
          />
        </CardContent>
      </Card>
    </div>
  )
}
