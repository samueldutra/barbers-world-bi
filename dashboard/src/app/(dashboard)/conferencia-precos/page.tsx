'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, ArrowUpDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FiltroSelecaoUnica } from '@/components/filtros/filtro-selecao-unica'
import { FiltroCanais } from '@/components/filtros/filtro-canais'
import { ConferenciaPrecosTabela, type AlteracaoPendente } from '@/components/conferencia-precos/conferencia-precos-tabela'
import {
  ConfirmarAlteracoesDialog,
  type AlteracaoConfirmada,
} from '@/components/conferencia-precos/confirmar-alteracoes-dialog'
import { useCanaisVenda } from '@/hooks/use-canais-venda'
import { useFiltrosProdutos } from '@/hooks/use-filtros-produtos'
import {
  useConferenciaPrecos,
  type LinhaConferencia,
  type OrdenarConferenciaPor,
  type StatusConferencia,
} from '@/hooks/use-conferencia-precos'
import { cn } from 'cn'
import { formatarNumero, formatarPrecoEdicao, parsePreco } from '@/lib/formatters'
import type { ResultadoAlteracao } from '@/app/api/conferencia-precos/alterar/route'

/** Canais cuja última venda vale como referência por padrão: loja física (BARBERS WORLD) e
 * site (Nuvem Shop). Marketplaces (Shopee/TikTok/ML) vendem com acréscimo e distorcem a
 * comparação — dá pra incluí-los pelo filtro. IDs = id_loja em barbers.canais_venda. */
const CANAIS_REFERENCIA_PADRAO = [204968632, 205291049]

// Ordenação pelo seletor (os cabeçalhos da tabela também ordenam). Cada opção já traz a
// direção que faz sentido — data e diferença mais relevantes primeiro.
const OPCOES_ORDENACAO: { value: string; label: string; coluna: OrdenarConferenciaPor; direcao: 'asc' | 'desc' }[] = [
  { value: 'nome', label: 'Nome (A–Z)', coluna: 'nome', direcao: 'asc' },
  { value: 'data_ultima_venda', label: 'Última venda mais recente', coluna: 'data_ultima_venda', direcao: 'desc' },
  { value: 'data_ultima_venda_antiga', label: 'Última venda mais antiga', coluna: 'data_ultima_venda', direcao: 'asc' },
  { value: 'diferenca_percentual', label: 'Maior queda na última venda', coluna: 'diferenca_percentual', direcao: 'asc' },
  { value: 'data_alteracao_preco', label: 'Preço alterado recentemente', coluna: 'data_alteracao_preco', direcao: 'desc' },
]

const TAMANHO_PAGINA = 50
const ITENS_POR_LOTE = 20 // mesmo limite da rota /api/conferencia-precos/alterar

const OPCOES_STATUS: { value: StatusConferencia; label: string }[] = [
  { value: 'divergentes', label: 'Diferentes da última venda' },
  { value: 'ultima_venda_menor', label: 'Última venda menor que o preço atual' },
  { value: 'alterados', label: 'Preço alterado' },
  { value: 'todos', label: 'Todos os ativos' },
]

export default function ConferenciaPrecosPage() {
  const [canais, setCanais] = useState<number[] | null>(CANAIS_REFERENCIA_PADRAO)
  const [descricao, setDescricao] = useState('')
  const [sku, setSku] = useState('')
  const [marca, setMarca] = useState<string | null>(null)
  const [categoria, setCategoria] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusConferencia>('divergentes')
  const [ordenarPor, setOrdenarPor] = useState<OrdenarConferenciaPor>('nome')
  const [ordenarDirecao, setOrdenarDirecao] = useState<'asc' | 'desc'>('asc')
  const [pagina, setPagina] = useState(1)

  const [alteracoes, setAlteracoes] = useState<Map<number, AlteracaoPendente>>(new Map())
  const [dialogAberto, setDialogAberto] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [progresso, setProgresso] = useState({ feitos: 0, total: 0 })

  const { canais: canaisDisponiveis } = useCanaisVenda()
  const { marcas, categorias } = useFiltrosProdutos()

  const { linhas, totalRegistros, loading, error, recarregar } = useConferenciaPrecos({
    canais,
    descricao,
    sku,
    marca,
    categoria,
    status,
    ordenarPor,
    ordenarDirecao,
    pagina,
    tamanhoPagina: TAMANHO_PAGINA,
  })

  // Toda mudança de filtro volta pra página 1. A seleção é mantida entre filtros/páginas
  // (dá pra montar um lote juntando produtos de buscas diferentes).
  const comReset = <T,>(setter: (v: T) => void) => (v: T) => {
    setPagina(1)
    setter(v)
  }

  const handleOrdenarChange = (coluna: OrdenarConferenciaPor) => {
    setPagina(1)
    if (coluna === ordenarPor) {
      setOrdenarDirecao((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setOrdenarPor(coluna)
      setOrdenarDirecao(coluna === 'nome' ? 'asc' : 'desc')
    }
  }

  // Opção do seletor que corresponde à ordenação atual; '' quando veio de um cabeçalho da
  // tabela sem equivalente no seletor (ex.: preço atual).
  const ordenacaoAtual =
    OPCOES_ORDENACAO.find((op) => op.coluna === ordenarPor && op.direcao === ordenarDirecao)?.value ?? ''

  const handleOrdenacaoSelect = (valor: string) => {
    const op = OPCOES_ORDENACAO.find((o) => o.value === valor)
    if (!op) return
    setPagina(1)
    setOrdenarPor(op.coluna)
    setOrdenarDirecao(op.direcao)
  }

  const atualizarAlteracoes = (fn: (m: Map<number, AlteracaoPendente>) => void) => {
    setAlteracoes((atual) => {
      const nova = new Map(atual)
      fn(nova)
      return nova
    })
  }

  const handleToggle = (linha: LinhaConferencia) =>
    atualizarAlteracoes((m) => {
      if (m.has(linha.id_produto)) m.delete(linha.id_produto)
      else m.set(linha.id_produto, { linha, preco: '', origem: 'manual' })
    })

  const handleToggleTodos = (marcar: boolean) =>
    atualizarAlteracoes((m) => {
      for (const linha of linhas) {
        if (marcar && !m.has(linha.id_produto)) m.set(linha.id_produto, { linha, preco: '', origem: 'manual' })
        if (!marcar) m.delete(linha.id_produto)
      }
    })

  const handlePrecoChange = (linha: LinhaConferencia, texto: string) =>
    atualizarAlteracoes((m) => {
      m.set(linha.id_produto, { linha, preco: texto, origem: 'manual', erro: null })
    })

  const handleUsarUltimaVenda = () => {
    const semReferencia = [...alteracoes.values()].filter((a) => a.linha.preco_ultima_venda === null).length
    atualizarAlteracoes((m) => {
      for (const [id, alt] of m) {
        const ref = alt.linha.preco_ultima_venda
        if (ref === null) continue
        m.set(id, { ...alt, preco: formatarPrecoEdicao(Number(ref)), origem: 'ultima_venda', erro: null })
      }
    })
    if (semReferencia > 0) {
      toast.warning(`${semReferencia} produto(s) sem venda nos canais de referência — defina o preço manualmente.`)
    }
  }

  // O que de fato vai pro Bling: preço válido e diferente do atual.
  const { prontos, semPreco, iguais } = useMemo(() => {
    const prontos: AlteracaoConfirmada[] = []
    let semPreco = 0
    let iguais = 0
    for (const alt of alteracoes.values()) {
      const preco = parsePreco(alt.preco)
      if (preco === null) semPreco++
      else if (alt.linha.preco_atual !== null && Math.abs(preco - Number(alt.linha.preco_atual)) < 0.005) iguais++
      else prontos.push({ linha: alt.linha, precoNovo: preco, origem: alt.origem })
    }
    return { prontos, semPreco, iguais }
  }, [alteracoes])

  const handleConfirmar = async () => {
    const itens = prontos
    setAplicando(true)
    setProgresso({ feitos: 0, total: itens.length })
    const resultados: ResultadoAlteracao[] = []

    for (let i = 0; i < itens.length; i += ITENS_POR_LOTE) {
      const lote = itens.slice(i, i + ITENS_POR_LOTE)
      try {
        const resp = await fetch('/api/conferencia-precos/alterar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itens: lote.map((it) => ({
              id_produto: it.linha.id_produto,
              preco_anterior: it.linha.preco_atual === null ? null : Number(it.linha.preco_atual),
              preco_novo: it.precoNovo,
              origem: it.origem,
            })),
          }),
        })
        const corpo = await resp.json().catch(() => null)
        if (!resp.ok) throw new Error(corpo?.error || `Erro ${resp.status}`)
        // Sessão expirada: o middleware redireciona /api/* pra /login e o fetch recebe HTML.
        if (!Array.isArray(corpo?.resultados)) throw new Error('Sessão expirada — entre novamente e repita.')
        resultados.push(...(corpo.resultados as ResultadoAlteracao[]))
      } catch (e) {
        const mensagem = e instanceof Error ? e.message : 'Falha na comunicação com o servidor.'
        resultados.push(...lote.map((it) => ({ id_produto: it.linha.id_produto, sucesso: false, erro: mensagem })))
      }
      setProgresso({ feitos: Math.min(i + lote.length, itens.length), total: itens.length })
    }

    // Sucesso sai da seleção; falha fica selecionada com a mensagem do Bling na linha.
    const falhas = resultados.filter((r) => !r.sucesso)
    atualizarAlteracoes((m) => {
      for (const r of resultados) {
        if (r.sucesso) m.delete(r.id_produto)
        else {
          const alt = m.get(r.id_produto)
          if (alt) m.set(r.id_produto, { ...alt, erro: r.erro })
        }
      }
    })

    setAplicando(false)
    const sucessos = resultados.length - falhas.length
    if (falhas.length === 0) {
      toast.success(`${formatarNumero(sucessos)} preço(s) alterado(s) no Bling.`)
      setDialogAberto(false)
    } else {
      toast.error(`${formatarNumero(sucessos)} alterado(s), ${formatarNumero(falhas.length)} com erro — veja a mensagem em cada linha.`)
      setDialogAberto(false)
    }
    recarregar()
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Conferência de preços</h1>
            <p className="text-sm text-muted-foreground">
              Preço de cadastro no Bling × preço cheio da última venda nos canais de referência
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={recarregar} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Atualizar
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Descrição..."
            value={descricao}
            onChange={(e) => comReset(setDescricao)(e.target.value)}
            className="h-8 w-full sm:w-56"
          />
          <Input
            placeholder="SKU..."
            value={sku}
            onChange={(e) => comReset(setSku)(e.target.value)}
            className="h-8 w-full sm:w-40"
          />
          <FiltroSelecaoUnica label="Marca" opcoes={marcas} valor={marca} onValorChange={comReset(setMarca)} />
          <FiltroSelecaoUnica label="Categoria" opcoes={categorias} valor={categoria} onValorChange={comReset(setCategoria)} />
          <FiltroCanais
            canais={canaisDisponiveis}
            canaisSelecionados={canais}
            onCanaisChange={comReset(setCanais)}
            prefixo="Referência"
            className="w-60"
          />
          <Select value={status} onValueChange={(v) => comReset(setStatus)(v as StatusConferencia)}>
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
          <Select value={ordenacaoAtual} onValueChange={handleOrdenacaoSelect}>
            <SelectTrigger className="w-60" size="sm">
              <ArrowUpDown className="h-4 w-4 opacity-50" />
              <SelectValue placeholder="Ordenação personalizada" />
            </SelectTrigger>
            <SelectContent>
              {OPCOES_ORDENACAO.map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {alteracoes.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-col gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            <span className="font-medium">{formatarNumero(alteracoes.size)} selecionado(s)</span>
            <span className="text-muted-foreground">
              {' '}· {formatarNumero(prontos.length)} pronto(s) pra alterar
              {semPreco > 0 && ` · ${formatarNumero(semPreco)} sem preço definido`}
              {iguais > 0 && ` · ${formatarNumero(iguais)} igual(is) ao atual`}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleUsarUltimaVenda} disabled={aplicando}>
              Usar preço da última venda
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAlteracoes(new Map())} disabled={aplicando}>
              <X className="h-4 w-4" />
              Limpar seleção
            </Button>
            <Button size="sm" onClick={() => setDialogAberto(true)} disabled={aplicando || prontos.length === 0}>
              Revisar e aplicar ({formatarNumero(prontos.length)})
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      )}

      <ConferenciaPrecosTabela
        linhas={linhas}
        totalRegistros={totalRegistros}
        loading={loading}
        alteracoes={alteracoes}
        onToggle={handleToggle}
        onToggleTodos={handleToggleTodos}
        onPrecoChange={handlePrecoChange}
        ordenarPor={ordenarPor}
        ordenarDirecao={ordenarDirecao}
        onOrdenarChange={handleOrdenarChange}
        pagina={pagina}
        tamanhoPagina={TAMANHO_PAGINA}
        onPaginaChange={setPagina}
        desabilitado={aplicando}
      />

      <ConfirmarAlteracoesDialog
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
