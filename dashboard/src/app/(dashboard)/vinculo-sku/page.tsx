'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { VinculoSkuTabela, type AlteracaoSkuPendente } from '@/components/vinculo-sku/vinculo-sku-tabela'
import { DivergenciasSkuPedidosDialog } from '@/components/vinculo-sku/divergencias-sku-pedidos-dialog'
import { EscolherProdutoBlingDialog, type ProdutoBlingBusca } from '@/components/vinculo-sku/escolher-produto-bling-dialog'
import { ConfirmarAlteracoesSkuDialog, type AlteracaoSkuConfirmada } from '@/components/vinculo-sku/confirmar-alteracoes-sku-dialog'
import type { ResultadoAlteracaoSku } from '@/app/api/vinculo-sku/alterar/route'
import {
  buscarParesConfirmados,
  buscarTodasLinhasVinculo,
  parUtilizavel,
  useParesConfirmados,
  type DivergenciaSkuPedidos,
  useResumoVinculoSku,
  useVinculoSku,
  type FiltroStatusVinculo,
  type LinhaVinculo,
  type OrdenarVinculoPor,
  type ParConfirmado,
} from '@/hooks/use-vinculo-sku'
import { cn } from 'cn'
import { formatarNumero } from '@/lib/formatters'
import { confiancaSugestao, infoStatusVinculo, linhaCorrigivel, ORDEM_STATUS_VINCULO, skuAlvo } from '@/lib/vinculo-sku'

const TAMANHO_PAGINA = 50
const ITENS_POR_LOTE = 15 // mesmo limite da rota /api/vinculo-sku/alterar

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
    'SKU sugerido (Bling)', 'Produto sugerido (Bling)', 'Confiança da sugestão', 'Similaridade',
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
      l.sugestao_codigo, l.sugestao_nome, l.sugestao_score === null ? null : confiancaSugestao(Number(l.sugestao_score)).label,
      l.sugestao_score,
    ].map(celula).join(';')
  )
  return '﻿' + [cabecalho.join(';'), ...corpo].join('\r\n')
}

export default function VinculoSkuPage() {
  const [status, setStatus] = useState<FiltroStatusVinculo>('problemas')
  const [busca, setBusca] = useState('')
  const [apenasPublicados, setApenasPublicados] = useState(true)
  const [apenasComEstoque, setApenasComEstoque] = useState(false)
  const [ordenarPor, setOrdenarPor] = useState<OrdenarVinculoPor>('status')
  const [ordenarDirecao, setOrdenarDirecao] = useState<'asc' | 'desc'>('asc')
  const [pagina, setPagina] = useState(1)
  const [exportando, setExportando] = useState(false)
  const [gatilhoResumo, setGatilhoResumo] = useState(0)

  const [alteracoes, setAlteracoes] = useState<Map<number, AlteracaoSkuPendente>>(new Map())
  const [linhaEscolhendo, setLinhaEscolhendo] = useState<LinhaVinculo | null>(null)
  const [divergenciasAbertas, setDivergenciasAbertas] = useState(false)
  const [dialogAberto, setDialogAberto] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [progresso, setProgresso] = useState({ feitos: 0, total: 0 })
  const [selecionando, setSelecionando] = useState(false)

  const { linhas, totalRegistros, loading, error, recarregar } = useVinculoSku({
    status, busca, apenasPublicados, apenasComEstoque, ordenarPor, ordenarDirecao, pagina, tamanhoPagina: TAMANHO_PAGINA,
  })
  const { resumo } = useResumoVinculoSku(apenasPublicados, apenasComEstoque, gatilhoResumo)
  const pares = useParesConfirmados(linhas, gatilhoResumo)

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

  // A seleção é mantida entre filtros e páginas (dá pra montar um lote juntando buscas diferentes).
  const atualizarAlteracoes = (fn: (m: Map<number, AlteracaoSkuPendente>) => void) => {
    setAlteracoes((atual) => {
      const nova = new Map(atual)
      fn(nova)
      return nova
    })
  }

  const novaSelecao = (linha: LinhaVinculo, parDado?: ParConfirmado): AlteracaoSkuPendente => {
    const par = parDado ?? (linha.id_variante !== null ? pares.get(linha.id_variante) : undefined)
    const parOk = parUtilizavel(par) ? par : null
    const alvo = skuAlvo(linha, parOk)
    const nomeBling =
      alvo.origem === 'pedidos' ? parOk?.nome : alvo.origem === 'ajuste' ? linha.nome_bling : alvo.origem === 'sugestao' ? linha.sugestao_nome : null
    return { linha, sku: alvo.sku, origem: alvo.origem, nomeBling }
  }

  const handleToggle = (linha: LinhaVinculo) =>
    atualizarAlteracoes((m) => {
      const id = linha.id_variante as number
      if (m.has(id)) m.delete(id)
      else m.set(id, novaSelecao(linha))
    })

  const handleToggleTodos = (marcar: boolean) =>
    atualizarAlteracoes((m) => {
      for (const linha of linhas.filter(linhaCorrigivel)) {
        const id = linha.id_variante as number
        if (marcar && !m.has(id)) m.set(id, novaSelecao(linha))
        if (!marcar) m.delete(id)
      }
    })

  const handleSkuChange = (linha: LinhaVinculo, texto: string) =>
    atualizarAlteracoes((m) => {
      const id = linha.id_variante as number
      const atual = m.get(id)
      const alvo = skuAlvo(linha)
      // Voltou a ser exatamente o valor sugerido → mantém a origem original; qualquer outra coisa é digitada.
      const origem = texto.trim() !== '' && texto.trim() === alvo.sku ? alvo.origem : 'manual'
      // Mexeu no texto à mão: o nome do produto escolhido/sugerido deixa de valer.
      m.set(id, { linha: atual?.linha ?? linha, sku: texto, origem, nomeBling: origem === 'manual' ? null : atual?.nomeBling, erro: null })
    })

  /** Seleção rápida (todas as páginas do filtro "com problema"): as de maior segurança. */
  /** Divergência SKU × pedidos: troca o SKU da variante pelo código do produto que as vendas mostram. */
  const handleCorrigirDivergencia = (d: DivergenciaSkuPedidos) => {
    const linha: LinhaVinculo = {
      visao: 'nuvemshop', store_id: d.store_id, id_produto_ns: d.id_produto_ns, id_variante: d.id_variante,
      nome_ns: d.nome_ns, variacao_ns: d.variacao_ns, sku_ns: d.sku_ns, publicado: d.publicado,
      preco_ns: null, preco_promocional_ns: null, estoque_ns: d.estoque_ns, url_ns: null, imagem_url: null,
      id_produto_bling: d.sku_id_produto_bling, codigo_bling: d.sku_codigo, nome_bling: d.sku_nome, preco_bling: null,
      formato_bling: null, qtd_bling: 1, status: 'vinculado',
      sugestao_id_produto_bling: null, sugestao_codigo: null, sugestao_nome: null, sugestao_preco: null, sugestao_score: null,
      total_registros: 0,
    }
    atualizarAlteracoes((m) => {
      m.set(d.id_variante, { linha, sku: d.vendas_codigo ?? '', origem: 'pedidos', nomeBling: d.vendas_nome, erro: null })
    })
    toast.success('Adicionada à seleção. Revise e grave pelo botão "Revisar e corrigir".')
  }

  /** Produto escolhido no seletor: seleciona a variante (se ainda não estava) e já preenche o SKU novo. */
  const handleEscolher = (linha: LinhaVinculo, produto: ProdutoBlingBusca) => {
    atualizarAlteracoes((m) => {
      m.set(linha.id_variante as number, { linha, sku: produto.codigo, origem: 'escolha', nomeBling: produto.nome, erro: null })
    })
    setLinhaEscolhendo(null)
  }

  const handleSelecionarRapido = async (tipo: 'pedidos' | 'identicas' | 'provaveis' | 'ajustes') => {
    setSelecionando(true)
    try {
      const [todas, todosPares] = await Promise.all([
        buscarTodasLinhasVinculo({ status: 'problemas', busca: '', apenasPublicados, apenasComEstoque, ordenarPor: 'status', ordenarDirecao: 'asc' }),
        buscarParesConfirmados(),
      ])
      const mapaPares = new Map(todosPares.map((p) => [p.id_variante, p]))
      const parDe = (l: LinhaVinculo) => (l.id_variante === null ? undefined : mapaPares.get(l.id_variante))
      const semVinculo = (l: LinhaVinculo) => l.status === 'sem_correspondencia' || l.status === 'sem_sku'
      const alvo = todas.filter((l) => {
        if (tipo === 'ajustes') return l.status === 'vinculado_ajustar'
        // Confirmados por pedidos: o par por ID, sem empate, ativo e com código livre (inclui SKU duplicado).
        if (tipo === 'pedidos') return (semVinculo(l) || l.status === 'sku_duplicado') && parUtilizavel(parDe(l))
        return semVinculo(l) && l.sugestao_score !== null && Number(l.sugestao_score) >= (tipo === 'identicas' ? 0.999 : 0.8)
      })
      atualizarAlteracoes((m) => {
        for (const l of alvo) if (l.id_variante !== null && !m.has(l.id_variante)) m.set(l.id_variante, novaSelecao(l, parDe(l)))
      })
      toast.success(`${formatarNumero(alvo.length)} variante(s) selecionada(s).`)
    } catch (e) {
      console.error('Erro na seleção rápida:', e)
      toast.error('Não foi possível selecionar. Tente de novo.')
    } finally {
      setSelecionando(false)
    }
  }

  // O que de fato vai pra Nuvemshop: SKU preenchido e diferente do atual. Só descarta o idêntico caractere a
  // caractere — espaço/maiúscula diferente conta como alteração (é o caso "ajuste").
  const { prontos, semSku, iguais } = useMemo(() => {
    const prontos: AlteracaoSkuConfirmada[] = []
    let semSku = 0
    let iguais = 0
    for (const alt of alteracoes.values()) {
      const sku = alt.sku.trim()
      if (!sku) semSku++
      else if (sku === (alt.linha.sku_ns ?? '')) iguais++
      else prontos.push({ linha: alt.linha, skuNovo: sku, origem: alt.origem, nomeBling: alt.nomeBling })
    }
    return { prontos, semSku, iguais }
  }, [alteracoes])

  const handleConfirmar = async () => {
    const itens = prontos
    setAplicando(true)
    setProgresso({ feitos: 0, total: itens.length })
    const resultados: ResultadoAlteracaoSku[] = []

    for (let i = 0; i < itens.length; i += ITENS_POR_LOTE) {
      const lote = itens.slice(i, i + ITENS_POR_LOTE)
      try {
        const resp = await fetch('/api/vinculo-sku/alterar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itens: lote.map((it) => ({
              store_id: it.linha.store_id,
              id_produto_ns: it.linha.id_produto_ns,
              id_variante: it.linha.id_variante,
              sku_anterior: it.linha.sku_ns,
              sku_novo: it.skuNovo,
              origem: it.origem,
            })),
          }),
        })
        const corpo = await resp.json().catch(() => null)
        if (!resp.ok) throw new Error(corpo?.error || `Erro ${resp.status}`)
        // Sessão expirada: o middleware redireciona /api/* pra /login e o fetch recebe HTML.
        if (!Array.isArray(corpo?.resultados)) throw new Error('Sessão expirada — entre novamente e repita.')
        resultados.push(...(corpo.resultados as ResultadoAlteracaoSku[]))
      } catch (e) {
        const mensagem = e instanceof Error ? e.message : 'Falha na comunicação com o servidor.'
        resultados.push(...lote.map((it) => ({ id_variante: it.linha.id_variante as number, sucesso: false, sku_gravado: null, erro: mensagem })))
      }
      setProgresso({ feitos: Math.min(i + lote.length, itens.length), total: itens.length })
    }

    // Sucesso sai da seleção; falha fica selecionada com a mensagem na linha.
    const falhas = resultados.filter((r) => !r.sucesso)
    atualizarAlteracoes((m) => {
      for (const r of resultados) {
        if (r.sucesso) m.delete(r.id_variante)
        else {
          const alt = m.get(r.id_variante)
          if (alt) m.set(r.id_variante, { ...alt, erro: r.erro })
        }
      }
    })

    setAplicando(false)
    setDialogAberto(false)
    const sucessos = resultados.length - falhas.length
    if (falhas.length === 0) toast.success(`${formatarNumero(sucessos)} SKU(s) corrigido(s) na Nuvemshop.`)
    else toast.error(`${formatarNumero(sucessos)} corrigido(s), ${formatarNumero(falhas.length)} com erro — veja a mensagem em cada linha.`)
    handleAtualizar()
  }

  const handleExportar = async () => {
    setExportando(true)
    try {
      const todas = await buscarTodasLinhasVinculo({ status, busca, apenasPublicados, apenasComEstoque, ordenarPor, ordenarDirecao })
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
          <label className="flex items-center gap-2 text-sm" title="Estoque maior que zero na Nuvemshop. Variantes sem controle de estoque ficam de fora.">
            <Checkbox checked={apenasComEstoque} onCheckedChange={(v) => comReset(setApenasComEstoque)(v === true)} />
            Só com estoque positivo na Nuvemshop
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Seleção rápida:</span>
        <Button variant="outline" size="sm" disabled={selecionando || aplicando} onClick={() => handleSelecionarRapido('pedidos')}>
          Confirmados por pedidos
        </Button>
        <Button variant="outline" size="sm" disabled={selecionando || aplicando} onClick={() => handleSelecionarRapido('identicas')}>
          Sugestões de nome idêntico
        </Button>
        <Button variant="outline" size="sm" disabled={selecionando || aplicando} onClick={() => handleSelecionarRapido('provaveis')}>
          Sugestões prováveis (≥ 80%)
        </Button>
        <Button variant="outline" size="sm" disabled={selecionando || aplicando} onClick={() => handleSelecionarRapido('ajustes')}>
          Ajustes de espaço/maiúscula
        </Button>
        <Button variant="ghost" size="sm" disabled={aplicando} onClick={() => setDivergenciasAbertas(true)}>
          Divergências SKU × pedidos
        </Button>
      </div>

      {alteracoes.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-col gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            <span className="font-medium">{formatarNumero(alteracoes.size)} selecionada(s)</span>
            <span className="text-muted-foreground">
              {' '}· {formatarNumero(prontos.length)} pronta(s) pra corrigir
              {semSku > 0 && ` · ${formatarNumero(semSku)} sem SKU novo definido`}
              {iguais > 0 && ` · ${formatarNumero(iguais)} já com esse SKU`}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAlteracoes(new Map())} disabled={aplicando}>
              <X className="h-4 w-4" />
              Limpar seleção
            </Button>
            <Button size="sm" onClick={() => setDialogAberto(true)} disabled={aplicando || prontos.length === 0}>
              Revisar e corrigir ({formatarNumero(prontos.length)})
            </Button>
          </div>
        </div>
      )}

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
        alteracoes={alteracoes}
        onToggle={handleToggle}
        onToggleTodos={handleToggleTodos}
        onSkuChange={handleSkuChange}
        onEscolher={setLinhaEscolhendo}
        pares={pares}
        desabilitado={aplicando}
      />

      <DivergenciasSkuPedidosDialog
        aberto={divergenciasAbertas}
        onOpenChange={setDivergenciasAbertas}
        selecionadas={new Set(alteracoes.keys())}
        onCorrigir={handleCorrigirDivergencia}
      />

      <EscolherProdutoBlingDialog linha={linhaEscolhendo} onOpenChange={(aberto) => !aberto && setLinhaEscolhendo(null)} onEscolher={handleEscolher} />

      <ConfirmarAlteracoesSkuDialog
        aberto={dialogAberto}
        onOpenChange={setDialogAberto}
        itens={prontos}
        aplicando={aplicando}
        progresso={progresso}
        onConfirmar={handleConfirmar}
      />
    </div>
  )
}
