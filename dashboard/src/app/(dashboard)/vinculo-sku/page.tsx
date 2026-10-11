'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { VinculoSkuTabela } from '@/components/vinculo-sku/vinculo-sku-tabela'
import {
  buscarTodasLinhasVinculo,
  useResumoVinculoSku,
  useVinculoSku,
  type FiltroStatusVinculo,
  type LinhaVinculo,
  type OrdenarVinculoPor,
} from '@/hooks/use-vinculo-sku'
import { cn } from 'cn'
import { formatarNumero } from '@/lib/formatters'
import { infoStatusVinculo, ORDEM_STATUS_VINCULO } from '@/lib/vinculo-sku'

const TAMANHO_PAGINA = 50

const OPCOES_STATUS: { value: FiltroStatusVinculo; label: string }[] = [
  { value: 'todos', label: 'Todas as variantes da Nuvemshop' },
  { value: 'problemas', label: 'Com problema (todos menos Vinculado)' },
  ...ORDEM_STATUS_VINCULO.map((s) => ({ value: s as FiltroStatusVinculo, label: infoStatusVinculo(s).label })),
]

/** CSV em pt-BR/Excel: separador ";" e BOM pra acentuar certo. */
function gerarCsv(linhas: LinhaVinculo[]): string {
  const cabecalho = [
    'Status', 'Produto Nuvemshop', 'Variação', 'SKU Nuvemshop', 'Publicado', 'Preço Nuvemshop', 'Preço promocional Nuvemshop',
    'Estoque Nuvemshop', 'Link na loja', 'ID produto Bling', 'SKU Bling', 'Produto Bling', 'Preço Bling', 'Qtde no Bling',
  ]
  const celula = (v: string | number | boolean | null) => {
    if (v === null || v === undefined) return ''
    const t = typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : typeof v === 'number' ? String(v).replace('.', ',') : v
    return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const corpo = linhas.map((l) =>
    [
      infoStatusVinculo(l.status).label, l.nome_ns, l.variacao_ns, l.sku_ns, l.publicado, l.preco_ns, l.preco_promocional_ns,
      l.estoque_ns, l.url_ns, l.id_produto_bling, l.codigo_bling, l.nome_bling, l.preco_bling, l.visao === 'nuvemshop' ? l.qtd_bling : null,
    ].map(celula).join(';')
  )
  return '﻿' + [cabecalho.join(';'), ...corpo].join('\r\n')
}

export default function VinculoSkuPage() {
  const [status, setStatus] = useState<FiltroStatusVinculo>('problemas')
  const [busca, setBusca] = useState('')
  const [apenasPublicados, setApenasPublicados] = useState(true)
  const [ordenarPor, setOrdenarPor] = useState<OrdenarVinculoPor>('status')
  const [ordenarDirecao, setOrdenarDirecao] = useState<'asc' | 'desc'>('asc')
  const [pagina, setPagina] = useState(1)
  const [exportando, setExportando] = useState(false)
  const [gatilhoResumo, setGatilhoResumo] = useState(0)

  const { linhas, totalRegistros, loading, error, recarregar } = useVinculoSku({
    status, busca, apenasPublicados, ordenarPor, ordenarDirecao, pagina, tamanhoPagina: TAMANHO_PAGINA,
  })
  const { resumo } = useResumoVinculoSku(apenasPublicados, gatilhoResumo)

  const comReset = <T,>(setter: (v: T) => void) => (v: T) => {
    setPagina(1)
    setter(v)
  }

  const handleOrdenarChange = (coluna: OrdenarVinculoPor) => {
    setPagina(1)
    if (coluna === ordenarPor) setOrdenarDirecao((d) => (d === 'desc' ? 'asc' : 'desc'))
    else {
      setOrdenarPor(coluna)
      setOrdenarDirecao('asc')
    }
  }

  const handleAtualizar = () => {
    recarregar()
    setGatilhoResumo((g) => g + 1)
  }

  const handleExportar = async () => {
    setExportando(true)
    try {
      const todas = await buscarTodasLinhasVinculo({ status, busca, apenasPublicados, ordenarPor, ordenarDirecao })
      const url = URL.createObjectURL(new Blob([gerarCsv(todas)], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `vinculo-sku-nuvemshop-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`${formatarNumero(todas.length)} linha(s) exportada(s).`)
    } catch (e) {
      console.error('Erro ao exportar o vínculo de SKU:', e)
      toast.error('Não foi possível exportar. Tente de novo.')
    } finally {
      setExportando(false)
    }
  }

  const totalNuvemshop = ORDEM_STATUS_VINCULO.filter((s) => s !== 'so_bling').reduce((soma, s) => soma + (resumo[s] ?? 0), 0)
  const cartoes: { chave: FiltroStatusVinculo; label: string; valor: number; descricao?: string }[] = [
    { chave: 'todos', label: 'Variantes na Nuvemshop', valor: totalNuvemshop },
    ...ORDEM_STATUS_VINCULO.map((s) => ({
      chave: s as FiltroStatusVinculo,
      label: infoStatusVinculo(s).label,
      valor: resumo[s] ?? 0,
      descricao: infoStatusVinculo(s).descricao,
    })),
  ]

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Vínculo de SKU</h1>
            <p className="text-sm text-muted-foreground">
              SKU de cada variante da Nuvemshop × código dos produtos ativos do Bling. A comparação ignora espaços e
              maiúsculas/minúsculas.
            </p>
          </div>
          <div className="flex items-center gap-2">
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

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          {cartoes.map((c) => (
            <button
              key={c.chave}
              type="button"
              title={c.descricao}
              onClick={() => comReset(setStatus)(c.chave)}
              className={cn(
                'rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50',
                status === c.chave && 'border-foreground/60 ring-1 ring-foreground/20'
              )}
            >
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatarNumero(c.valor)}</p>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Buscar por nome ou SKU..."
            value={busca}
            onChange={(e) => comReset(setBusca)(e.target.value)}
            className="h-8 w-full sm:w-72"
          />
          <Select value={status} onValueChange={(v) => comReset(setStatus)(v)}>
            <SelectTrigger className="w-72" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPCOES_STATUS.map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={apenasPublicados} onCheckedChange={(v) => comReset(setApenasPublicados)(v === true)} />
            Só produtos publicados na Nuvemshop
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      )}

      <VinculoSkuTabela
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
    </div>
  )
}
