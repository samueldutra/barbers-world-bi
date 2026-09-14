'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { VendasFiltros } from '@/components/dashboard/vendas-filtros'
import { RelatorioProdutosTabela } from '@/components/relatorio-produtos/relatorio-produtos-tabela'
import { CurvaAbcTabela } from '@/components/relatorio-produtos/curva-abc-tabela'
import { FiltroSelecaoUnica } from '@/components/filtros/filtro-selecao-unica'
import { useCanaisVenda } from '@/hooks/use-canais-venda'
import { useFiltrosProdutos } from '@/hooks/use-filtros-produtos'
import { useRelatorioProdutos, type LinhaRelatorioProduto, type OrdenarRelatorioPor } from '@/hooks/use-relatorio-produtos'
import { useCurvaAbc } from '@/hooks/use-curva-abc'
import { obterRangePreset, formatarRangeParaAPI, type PeriodoPreset, type RangeData } from '@/lib/date-ranges'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { exportarCSV, exportarXLSX, type ColunaExportavel } from '@/lib/export'

const COLUNAS_EXPORTACAO: ColunaExportavel<LinhaRelatorioProduto>[] = [
  { cabecalho: 'Código', valor: (l) => l.codigo || '', largura: 18 },
  { cabecalho: 'Produto', valor: (l) => l.nome || 'Produto sem nome', largura: 42 },
  { cabecalho: 'Marca', valor: (l) => l.marca || 'Sem marca', largura: 18 },
  { cabecalho: 'Categoria', valor: (l) => l.categoria_descricao || 'Sem categoria', largura: 22 },
  { cabecalho: 'Qtde vendida', valor: (l) => Number(l.unidades_vendidas), largura: 14 },
  { cabecalho: 'Valor vendido (R$)', valor: (l) => Number(l.faturamento), largura: 18, formatoNumerico: '#,##0.00' },
  { cabecalho: 'Pedidos', valor: (l) => Number(l.pedidos), largura: 12 },
]

const TAMANHO_PAGINA = 50
const LIMITE_EXPORTACAO = 20000

export default function RelatorioProdutosPage() {
  const [periodo, setPeriodo] = useState<PeriodoPreset>('mes_atual')
  const [rangePersonalizado, setRangePersonalizado] = useState<RangeData | null>(null)
  const [canaisSelecionados, setCanaisSelecionados] = useState<number[] | null>(null)
  const [marcaSelecionada, setMarcaSelecionada] = useState<string | null>(null)
  const [categoriaSelecionada, setCategoriaSelecionada] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [ordenarPor, setOrdenarPor] = useState<OrdenarRelatorioPor>('valor_vendido')
  const [ordenarDirecao, setOrdenarDirecao] = useState<'asc' | 'desc'>('desc')
  const [pagina, setPagina] = useState(1)
  const [exportando, setExportando] = useState(false)

  const atual = useMemo(
    () => (periodo === 'personalizado' ? (rangePersonalizado ?? obterRangePreset(periodo)) : obterRangePreset(periodo)),
    [periodo, rangePersonalizado]
  )
  const { canais } = useCanaisVenda()
  const { marcas, categorias: categoriasDisponiveis } = useFiltrosProdutos()

  const { linhas, totalRegistros, loading, error, recarregar } = useRelatorioProdutos({
    atual,
    canais: canaisSelecionados,
    busca,
    marca: marcaSelecionada,
    categoria: categoriaSelecionada,
    ordenarPor,
    ordenarDirecao,
    pagina,
    tamanhoPagina: TAMANHO_PAGINA,
  })

  const { categorias, loading: loadingAbc } = useCurvaAbc({ atual, canais: canaisSelecionados, marca: marcaSelecionada })

  const handleOrdenarChange = (coluna: OrdenarRelatorioPor) => {
    setPagina(1)
    if (coluna === ordenarPor) {
      setOrdenarDirecao((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setOrdenarPor(coluna)
      setOrdenarDirecao('desc')
    }
  }

  const handleBuscaChange = (v: string) => {
    setPagina(1)
    setBusca(v)
  }

  const handlePeriodoChange = (p: PeriodoPreset) => {
    setPagina(1)
    setPeriodo(p)
  }

  const handleRangePersonalizadoChange = (r: RangeData) => {
    setPagina(1)
    setRangePersonalizado(r)
  }

  const handleCanaisChange = (ids: number[] | null) => {
    setPagina(1)
    setCanaisSelecionados(ids)
  }

  const handleMarcaChange = (v: string | null) => {
    setPagina(1)
    setMarcaSelecionada(v)
  }

  const handleCategoriaChange = (v: string | null) => {
    setPagina(1)
    setCategoriaSelecionada(v)
  }

  const handleExportar = async (formato: 'csv' | 'xlsx') => {
    setExportando(true)
    try {
      const supabase = createClient()
      const { data_inicial, data_final } = formatarRangeParaAPI(atual)
      const { data, error } = await supabase.rpc('obter_relatorio_vendas_produtos', {
        p_schema_name: TENANT_SCHEMA,
        p_data_inicial: data_inicial,
        p_data_final: data_final,
        p_canais: canaisSelecionados,
        p_busca: busca.trim() || null,
        p_marca: marcaSelecionada,
        p_categoria: categoriaSelecionada,
        p_ordenar_por: ordenarPor,
        p_ordenar_direcao: ordenarDirecao,
        p_pagina: 1,
        p_tamanho_pagina: Math.min(Math.max(totalRegistros, 1), LIMITE_EXPORTACAO),
      })
      if (error) throw error

      const linhasExportar = (data as LinhaRelatorioProduto[]) ?? []
      const nomeBase = `vendas-por-produto_${new Date().toISOString().slice(0, 10)}`
      if (formato === 'csv') {
        exportarCSV(linhasExportar, COLUNAS_EXPORTACAO, `${nomeBase}.csv`)
      } else {
        await exportarXLSX(linhasExportar, COLUNAS_EXPORTACAO, `${nomeBase}.xlsx`, 'Vendas por produto')
      }
      toast.success(`Exportação concluída: ${linhasExportar.length} produtos.`)
    } catch (err) {
      console.error('Erro ao exportar relatório de vendas por produto:', err)
      toast.error('Não foi possível exportar o relatório.')
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Relatório de vendas por produto</h1>
          <p className="text-sm text-muted-foreground">
            Listagem detalhada e curva ABC por categoria
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <VendasFiltros
            periodo={periodo}
            onPeriodoChange={handlePeriodoChange}
            rangePersonalizado={rangePersonalizado}
            onRangePersonalizadoChange={handleRangePersonalizadoChange}
            canais={canais}
            canaisSelecionados={canaisSelecionados}
            onCanaisChange={handleCanaisChange}
            onAtualizar={recarregar}
            atualizando={loading}
          />
          <FiltroSelecaoUnica label="Marca" opcoes={marcas} valor={marcaSelecionada} onValorChange={handleMarcaChange} />
          <FiltroSelecaoUnica
            label="Categoria"
            opcoes={categoriasDisponiveis}
            valor={categoriaSelecionada}
            onValorChange={handleCategoriaChange}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <RelatorioProdutosTabela
        linhas={linhas}
        totalRegistros={totalRegistros}
        loading={loading}
        busca={busca}
        onBuscaChange={handleBuscaChange}
        ordenarPor={ordenarPor}
        ordenarDirecao={ordenarDirecao}
        onOrdenarChange={handleOrdenarChange}
        pagina={pagina}
        tamanhoPagina={TAMANHO_PAGINA}
        onPaginaChange={setPagina}
        onExportar={handleExportar}
        exportando={exportando}
      />

      <CurvaAbcTabela categorias={categorias} loading={loadingAbc} />
    </div>
  )
}
