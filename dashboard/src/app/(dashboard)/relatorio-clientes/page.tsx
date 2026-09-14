'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { VendasFiltros } from '@/components/dashboard/vendas-filtros'
import { RelatorioClientesTabela } from '@/components/relatorio-clientes/relatorio-clientes-tabela'
import { CurvaAbcClientesTabela } from '@/components/relatorio-clientes/curva-abc-clientes-tabela'
import { FiltroSelecaoUnica } from '@/components/filtros/filtro-selecao-unica'
import { useCanaisVenda } from '@/hooks/use-canais-venda'
import { useFiltrosClientes } from '@/hooks/use-filtros-clientes'
import { useRelatorioClientes, type LinhaRelatorioCliente, type OrdenarClientesPor } from '@/hooks/use-relatorio-clientes'
import { useCurvaAbcClientes } from '@/hooks/use-curva-abc-clientes'
import { obterRangePreset, formatarRangeParaAPI, type PeriodoPreset, type RangeData } from '@/lib/date-ranges'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { exportarCSV, exportarXLSX, type ColunaExportavel } from '@/lib/export'
import { formatarData } from '@/lib/formatters'

const TAMANHO_PAGINA = 50
const LIMITE_EXPORTACAO = 20000
const LIMITE_CURVA_ABC = 50

const COLUNAS_EXPORTACAO: ColunaExportavel<LinhaRelatorioCliente>[] = [
  { cabecalho: 'Cliente', valor: (l) => l.nome_contato || 'Cliente sem nome', largura: 32 },
  { cabecalho: 'Status', valor: (l) => l.status_cliente, largura: 14 },
  { cabecalho: 'Documento', valor: (l) => l.documento_contato || '', largura: 20 },
  { cabecalho: 'Cidade', valor: (l) => l.municipio || '', largura: 20 },
  { cabecalho: 'UF', valor: (l) => l.uf || '', largura: 6 },
  { cabecalho: 'Telefone', valor: (l) => l.telefone || '', largura: 18 },
  { cabecalho: 'E-mail', valor: (l) => l.email || '', largura: 28 },
  { cabecalho: 'Pedidos', valor: (l) => Number(l.total_pedidos), largura: 12 },
  { cabecalho: 'Qtde vendida', valor: (l) => Number(l.unidades_vendidas), largura: 14 },
  { cabecalho: 'Valor vendido (R$)', valor: (l) => Number(l.faturamento), largura: 18, formatoNumerico: '#,##0.00' },
  { cabecalho: 'Ticket médio (R$)', valor: (l) => Number(l.ticket_medio), largura: 16, formatoNumerico: '#,##0.00' },
  { cabecalho: 'Última compra', valor: (l) => (l.ultima_compra ? formatarData(l.ultima_compra) : ''), largura: 14 },
]

export default function RelatorioClientesPage() {
  const [periodo, setPeriodo] = useState<PeriodoPreset>('mes_atual')
  const [rangePersonalizado, setRangePersonalizado] = useState<RangeData | null>(null)
  const [canaisSelecionados, setCanaisSelecionados] = useState<number[] | null>(null)
  const [ufSelecionada, setUfSelecionada] = useState<string | null>(null)
  const [cidadeSelecionada, setCidadeSelecionada] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [ordenarPor, setOrdenarPor] = useState<OrdenarClientesPor>('valor_vendido')
  const [ordenarDirecao, setOrdenarDirecao] = useState<'asc' | 'desc'>('desc')
  const [pagina, setPagina] = useState(1)
  const [exportando, setExportando] = useState(false)

  const atual = useMemo(
    () => (periodo === 'personalizado' ? (rangePersonalizado ?? obterRangePreset(periodo)) : obterRangePreset(periodo)),
    [periodo, rangePersonalizado]
  )
  const { canais } = useCanaisVenda()
  const { ufs, municipios } = useFiltrosClientes(ufSelecionada)

  const { linhas, totalRegistros, loading, error, recarregar } = useRelatorioClientes({
    atual,
    canais: canaisSelecionados,
    busca,
    uf: ufSelecionada,
    cidade: cidadeSelecionada,
    ordenarPor,
    ordenarDirecao,
    pagina,
    tamanhoPagina: TAMANHO_PAGINA,
  })

  const { clientes: clientesAbc, loading: loadingAbc } = useCurvaAbcClientes({
    atual,
    canais: canaisSelecionados,
    uf: ufSelecionada,
    cidade: cidadeSelecionada,
    limite: LIMITE_CURVA_ABC,
  })

  const handleOrdenarChange = (coluna: OrdenarClientesPor) => {
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

  const handleUfChange = (v: string | null) => {
    setPagina(1)
    setUfSelecionada(v)
    setCidadeSelecionada(null) // cidade depende da UF — troca de UF invalida a cidade escolhida
  }

  const handleCidadeChange = (v: string | null) => {
    setPagina(1)
    setCidadeSelecionada(v)
  }

  const handleExportar = async (formato: 'csv' | 'xlsx') => {
    setExportando(true)
    try {
      const supabase = createClient()
      const { data_inicial, data_final } = formatarRangeParaAPI(atual)
      const { data, error } = await supabase.rpc('obter_relatorio_vendas_clientes', {
        p_schema_name: TENANT_SCHEMA,
        p_data_inicial: data_inicial,
        p_data_final: data_final,
        p_canais: canaisSelecionados,
        p_busca: busca.trim() || null,
        p_uf: ufSelecionada,
        p_cidade: cidadeSelecionada,
        p_ordenar_por: ordenarPor,
        p_ordenar_direcao: ordenarDirecao,
        p_pagina: 1,
        p_tamanho_pagina: Math.min(Math.max(totalRegistros, 1), LIMITE_EXPORTACAO),
      })
      if (error) throw error

      const linhasExportar = (data as LinhaRelatorioCliente[]) ?? []
      const nomeBase = `vendas-por-cliente_${new Date().toISOString().slice(0, 10)}`
      if (formato === 'csv') {
        exportarCSV(linhasExportar, COLUNAS_EXPORTACAO, `${nomeBase}.csv`)
      } else {
        await exportarXLSX(linhasExportar, COLUNAS_EXPORTACAO, `${nomeBase}.xlsx`, 'Vendas por cliente')
      }
      toast.success(`Exportação concluída: ${linhasExportar.length} clientes.`)
    } catch (err) {
      console.error('Erro ao exportar relatório de vendas por cliente:', err)
      toast.error('Não foi possível exportar o relatório.')
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Relatório de vendas por cliente</h1>
          <p className="text-sm text-muted-foreground">
            Pedidos, faturamento e ticket médio por cliente no período
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
          <FiltroSelecaoUnica label="UF" opcoes={ufs} valor={ufSelecionada} onValorChange={handleUfChange} />
          <FiltroSelecaoUnica label="Cidade" opcoes={municipios} valor={cidadeSelecionada} onValorChange={handleCidadeChange} />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <RelatorioClientesTabela
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

      <CurvaAbcClientesTabela clientes={clientesAbc} loading={loadingAbc} limite={LIMITE_CURVA_ABC} />
    </div>
  )
}
