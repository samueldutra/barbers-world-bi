'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { VendasFiltros } from '@/components/dashboard/vendas-filtros'
import { RelatorioClientesTabela } from '@/components/relatorio-clientes/relatorio-clientes-tabela'
import { CurvaAbcClientesTabela } from '@/components/relatorio-clientes/curva-abc-clientes-tabela'
import { FiltroSelecaoUnica } from '@/components/filtros/filtro-selecao-unica'
import { FiltroUltimaCompra, calcularUltimaCompraAntesDe, type UltimaCompraPreset } from '@/components/relatorio-clientes/filtro-ultima-compra'
import { FiltroFrequenciaCompra, calcularFrequenciaFaixa, type FrequenciaCompraPreset } from '@/components/relatorio-clientes/filtro-frequencia-compra'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useCanaisVenda } from '@/hooks/use-canais-venda'
import { useFiltrosClientes } from '@/hooks/use-filtros-clientes'
import { useRelatorioClientes, type LinhaRelatorioCliente, type OrdenarClientesPor } from '@/hooks/use-relatorio-clientes'
import { useCurvaAbcClientes } from '@/hooks/use-curva-abc-clientes'
import { obterRangePreset, formatarRangeParaAPI, type PeriodoPreset, type RangeData } from '@/lib/date-ranges'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { exportarCSV, exportarXLSX, type ColunaExportavel } from '@/lib/export'
import { formatarData, formatarAniversario, formatarDias } from '@/lib/formatters'
import { linkWhatsapp } from '@/lib/whatsapp'

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
  { cabecalho: 'Link WhatsApp', valor: (l) => linkWhatsapp(l.telefone) || '', largura: 32 },
  { cabecalho: 'E-mail', valor: (l) => l.email || '', largura: 28 },
  { cabecalho: 'Aniversário', valor: (l) => (l.data_nascimento ? formatarAniversario(l.data_nascimento) : ''), largura: 12 },
  { cabecalho: 'Pedidos', valor: (l) => Number(l.total_pedidos), largura: 12 },
  { cabecalho: 'Qtde vendida', valor: (l) => Number(l.unidades_vendidas), largura: 14 },
  { cabecalho: 'Valor vendido (R$)', valor: (l) => Number(l.faturamento), largura: 18, formatoNumerico: '#,##0.00' },
  { cabecalho: 'Ticket médio (R$)', valor: (l) => Number(l.ticket_medio), largura: 16, formatoNumerico: '#,##0.00' },
  { cabecalho: 'Última compra', valor: (l) => (l.ultima_compra ? formatarData(l.ultima_compra) : ''), largura: 14 },
  { cabecalho: 'Frequência média (dias)', valor: (l) => l.frequencia_media_dias ?? '', largura: 20 },
]

export default function RelatorioClientesPage() {
  const [periodo, setPeriodo] = useState<PeriodoPreset>('mes_atual')
  const [rangePersonalizado, setRangePersonalizado] = useState<RangeData | null>(null)
  const [canaisSelecionados, setCanaisSelecionados] = useState<number[] | null>(null)
  const [cidadeSelecionada, setCidadeSelecionada] = useState<string | null>(null)
  const [ultimaCompraPreset, setUltimaCompraPreset] = useState<UltimaCompraPreset>('todos')
  const [dataPersonalizadaUltimaCompra, setDataPersonalizadaUltimaCompra] = useState<Date | null>(null)
  const [incluirSemVenda, setIncluirSemVenda] = useState(true)
  const [frequenciaPreset, setFrequenciaPreset] = useState<FrequenciaCompraPreset>('todos')
  const [frequenciaPersonalizada, setFrequenciaPersonalizada] = useState<{ min: number | null; max: number | null }>({
    min: null,
    max: null,
  })
  const [busca, setBusca] = useState('')
  const [ordenarPor, setOrdenarPor] = useState<OrdenarClientesPor>('valor_vendido')
  const [ordenarDirecao, setOrdenarDirecao] = useState<'asc' | 'desc'>('desc')
  const [pagina, setPagina] = useState(1)
  const [exportando, setExportando] = useState(false)

  const atual = useMemo(
    () => (periodo === 'personalizado' ? (rangePersonalizado ?? obterRangePreset(periodo)) : obterRangePreset(periodo)),
    [periodo, rangePersonalizado]
  )
  const ultimaCompraAntesDe = useMemo(
    () => calcularUltimaCompraAntesDe(ultimaCompraPreset, dataPersonalizadaUltimaCompra),
    [ultimaCompraPreset, dataPersonalizadaUltimaCompra]
  )
  const frequenciaFaixa = useMemo(
    () => calcularFrequenciaFaixa(frequenciaPreset, frequenciaPersonalizada),
    [frequenciaPreset, frequenciaPersonalizada]
  )
  const { canais } = useCanaisVenda()
  const { municipios } = useFiltrosClientes()

  const { linhas, totalRegistros, loading, error, recarregar } = useRelatorioClientes({
    atual,
    canais: canaisSelecionados,
    busca,
    cidade: cidadeSelecionada,
    ultimaCompraAntesDe,
    incluirSemVenda,
    frequenciaMinDias: frequenciaFaixa.min,
    frequenciaMaxDias: frequenciaFaixa.max,
    ordenarPor,
    ordenarDirecao,
    pagina,
    tamanhoPagina: TAMANHO_PAGINA,
  })

  const { clientes: clientesAbc, loading: loadingAbc } = useCurvaAbcClientes({
    atual,
    canais: canaisSelecionados,
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

  const handleCidadeChange = (v: string | null) => {
    setPagina(1)
    setCidadeSelecionada(v)
  }

  const handleUltimaCompraPresetChange = (p: UltimaCompraPreset) => {
    setPagina(1)
    setUltimaCompraPreset(p)
    // Quem tá procurando cliente sumido normalmente quer ver primeiro quem tá sumido há
    // mais tempo — troca a ordenação padrão pra ajudar, sem travar se a pessoa já tinha
    // escolhido outra coluna.
    if (p !== 'todos' && ordenarPor !== 'ultima_compra') {
      setOrdenarPor('ultima_compra')
      setOrdenarDirecao('asc')
    }
  }

  const handleDataPersonalizadaChange = (d: Date) => {
    setPagina(1)
    setDataPersonalizadaUltimaCompra(d)
  }

  const handleIncluirSemVendaChange = (v: boolean) => {
    setPagina(1)
    setIncluirSemVenda(v)
  }

  const handleFrequenciaPresetChange = (p: FrequenciaCompraPreset) => {
    setPagina(1)
    setFrequenciaPreset(p)
  }

  const handleFrequenciaPersonalizadaChange = (f: { min: number | null; max: number | null }) => {
    setPagina(1)
    setFrequenciaPersonalizada(f)
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
        p_cidade: cidadeSelecionada,
        p_ultima_compra_antes_de: ultimaCompraAntesDe,
        p_incluir_sem_venda: incluirSemVenda,
        p_frequencia_min_dias: frequenciaFaixa.min,
        p_frequencia_max_dias: frequenciaFaixa.max,
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
          <FiltroSelecaoUnica label="Cidade" opcoes={municipios} valor={cidadeSelecionada} onValorChange={handleCidadeChange} />
          <FiltroUltimaCompra
            preset={ultimaCompraPreset}
            onPresetChange={handleUltimaCompraPresetChange}
            dataPersonalizada={dataPersonalizadaUltimaCompra}
            onDataPersonalizadaChange={handleDataPersonalizadaChange}
          />
          <FiltroFrequenciaCompra
            preset={frequenciaPreset}
            onPresetChange={handleFrequenciaPresetChange}
            personalizada={frequenciaPersonalizada}
            onPersonalizadaChange={handleFrequenciaPersonalizadaChange}
          />
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <Checkbox
              id="incluir-sem-venda"
              checked={incluirSemVenda}
              onCheckedChange={(v) => handleIncluirSemVendaChange(v === true)}
            />
            <Label htmlFor="incluir-sem-venda" className="text-sm font-normal">
              Filtrar clientes sem venda
            </Label>
          </div>
        </div>
      </div>

      {ultimaCompraPreset !== 'todos' && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground">
          Mostrando todo cliente sem comprar desde {ultimaCompraAntesDe ? formatarData(ultimaCompraAntesDe) : '—'} —
          independente do período selecionado acima. Pedidos/valor vendido/ticket médio abaixo continuam contando só
          o período em tela, não o histórico completo do cliente.
        </div>
      )}

      {frequenciaPreset !== 'todos' && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground">
          Mostrando cliente com frequência média de compra{' '}
          {frequenciaFaixa.min != null && `de pelo menos ${formatarDias(frequenciaFaixa.min)}`}
          {frequenciaFaixa.min != null && frequenciaFaixa.max != null && ' e '}
          {frequenciaFaixa.max != null && `de até ${formatarDias(frequenciaFaixa.max)}`} — calculada sobre o histórico
          completo do cliente, não o período selecionado acima. Cliente com só 1 pedido no histórico fica de fora
          (sem frequência pra medir).
        </div>
      )}

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
