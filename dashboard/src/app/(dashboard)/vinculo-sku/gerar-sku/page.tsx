'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ChevronLeft, ChevronRight, FlaskConical, Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from 'cn'
import { formatarMoeda, formatarNumero } from '@/lib/formatters'
import { buscarTodasPropostas, usePropostasSkuBling, useResumoPropostas, type LinhaProposta } from '@/hooks/use-propostas-sku-bling'
import type { ResultadoAplicacaoSku } from '@/app/api/sku-bling/aplicar/route'

const TAMANHO_PAGINA = 50
const ITENS_POR_LOTE = 8 // mesmo limite da rota /api/sku-bling/aplicar

const STATUS: Record<string, { label: string; classe: string }> = {
  pendente: { label: 'Pendente', classe: 'bg-muted text-muted-foreground' },
  aplicado: { label: 'Aplicado', classe: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  erro: { label: 'Erro', classe: 'bg-destructive/10 text-destructive' },
  excluido: { label: 'Excluído', classe: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
}
const ORDEM = ['pendente', 'aplicado', 'erro', 'excluido']

/** Produto sugerido pra primeira aplicação: sem vendas, fora da Nuvemshop, sem colisão de código. */
const PRODUTO_TESTE = 'POMADA ARGILA 70G CABRO'

const aplicavel = (l: LinhaProposta) => l.status === 'pendente' || l.status === 'erro'

export default function GerarSkuBlingPage() {
  const [status, setStatus] = useState('pendente')
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1)
  const [gatilho, setGatilho] = useState(0)
  const [selecionados, setSelecionados] = useState<Map<number, LinhaProposta>>(new Map())
  const [dialogAberto, setDialogAberto] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [progresso, setProgresso] = useState({ feitos: 0, total: 0 })
  const [errosPorProduto, setErrosPorProduto] = useState<Record<number, string>>({})
  const [selecionandoTodos, setSelecionandoTodos] = useState(false)
  const cancelarRef = useRef(false)

  const resumo = useResumoPropostas(gatilho)
  const { linhas, totalRegistros, loading, error } = usePropostasSkuBling({ status, busca, pagina, tamanhoPagina: TAMANHO_PAGINA }, gatilho)

  const modoTeste = (resumo.aplicado ?? 0) === 0
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / TAMANHO_PAGINA))
  const inicio = totalRegistros === 0 ? 0 : (pagina - 1) * TAMANHO_PAGINA + 1
  const fim = Math.min(pagina * TAMANHO_PAGINA, totalRegistros)
  const lista = [...selecionados.values()]
  const comVendas = lista.filter((l) => l.com_vendas).length

  const comReset = <T,>(setter: (v: T) => void) => (v: T) => {
    setPagina(1)
    setter(v)
  }

  const recarregar = () => setGatilho((g) => g + 1)

  const handleToggle = (linha: LinhaProposta) =>
    setSelecionados((atual) => {
      const nova = new Map(atual)
      if (nova.has(linha.id_produto)) nova.delete(linha.id_produto)
      else if (modoTeste) {
        // Modo teste: 1 produto só — marcar outro troca a seleção.
        nova.clear()
        nova.set(linha.id_produto, linha)
      } else nova.set(linha.id_produto, linha)
      return nova
    })

  const handleToggleTodos = (marcar: boolean) =>
    setSelecionados((atual) => {
      if (modoTeste) return atual
      const nova = new Map(atual)
      for (const l of linhas.filter(aplicavel)) {
        if (marcar) nova.set(l.id_produto, l)
        else nova.delete(l.id_produto)
      }
      return nova
    })

  /** Seleção em massa (todas as páginas): 'sem_vendas' = menor risco (o código novo não aparece em nota nenhuma). */
  const handleSelecionarMassa = async (tipo: 'sem_vendas' | 'todas') => {
    setSelecionandoTodos(true)
    try {
      const [pendentes, comErro] = await Promise.all([buscarTodasPropostas('pendente'), buscarTodasPropostas('erro')])
      const alvo = [...pendentes, ...comErro].filter((l) => tipo === 'todas' || !l.com_vendas)
      setSelecionados((atual) => {
        const nova = new Map(atual)
        for (const l of alvo) nova.set(l.id_produto, l)
        return nova
      })
      toast.success(`${formatarNumero(alvo.length)} produto(s) selecionado(s).`)
    } catch (e) {
      console.error('Erro na seleção em massa:', e)
      toast.error('Não foi possível selecionar. Tente de novo.')
    } finally {
      setSelecionandoTodos(false)
    }
  }

  const aplicaveisNaPagina = linhas.filter(aplicavel)
  const marcadosNaPagina = aplicaveisNaPagina.filter((l) => selecionados.has(l.id_produto)).length
  const estadoCabecalho = marcadosNaPagina === 0 ? false : marcadosNaPagina === aplicaveisNaPagina.length ? true : 'indeterminate'

  const handleConfirmar = async () => {
    const itens = lista
    setAplicando(true)
    setProgresso({ feitos: 0, total: itens.length })
    setErrosPorProduto({})
    cancelarRef.current = false
    const resultados: ResultadoAplicacaoSku[] = []

    // Em modo teste só existe 1 item. Fora dele, lotes pequenos (limite do Bling compartilhado com o ETL).
    for (let i = 0; i < itens.length; i += ITENS_POR_LOTE) {
      // "Parar": termina o lote em andamento e não envia os próximos (o que já foi gravado fica gravado).
      if (cancelarRef.current) break
      const lote = itens.slice(i, i + ITENS_POR_LOTE)
      try {
        const resp = await fetch('/api/sku-bling/aplicar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itens: lote.map((l) => ({ id_produto: l.id_produto })) }),
        })
        const corpo = await resp.json().catch(() => null)
        if (!resp.ok) throw new Error(corpo?.error || `Erro ${resp.status}`)
        // Sessão expirada: o middleware redireciona /api/* pra /login e o fetch recebe HTML.
        if (!Array.isArray(corpo?.resultados)) throw new Error('Sessão expirada — entre novamente e repita.')
        resultados.push(...(corpo.resultados as ResultadoAplicacaoSku[]))
      } catch (e) {
        const mensagem = e instanceof Error ? e.message : 'Falha na comunicação com o servidor.'
        resultados.push(...lote.map((l) => ({ id_produto: l.id_produto, sucesso: false, codigo_gravado: null, erro: mensagem })))
      }
      setProgresso({ feitos: Math.min(i + lote.length, itens.length), total: itens.length })
    }

    const falhas = resultados.filter((r) => !r.sucesso)
    setSelecionados((atual) => {
      const nova = new Map(atual)
      for (const r of resultados) if (r.sucesso) nova.delete(r.id_produto)
      return nova
    })
    setErrosPorProduto(Object.fromEntries(falhas.map((r) => [r.id_produto, r.erro ?? 'Erro'])))
    setAplicando(false)
    setDialogAberto(false)

    const sucessos = resultados.length - falhas.length
    const naoEnviados = itens.length - resultados.length
    if (naoEnviados > 0) toast.info(`Interrompido: ${formatarNumero(sucessos)} gravado(s); ${formatarNumero(naoEnviados)} não enviado(s) continuam selecionados.`)
    else if (falhas.length === 0) toast.success(`${formatarNumero(sucessos)} SKU(s) gravado(s) e confirmado(s) no Bling.`)
    else toast.error(falhas[0].erro ?? 'Falha ao gravar no Bling.', { description: `${sucessos} ok, ${falhas.length} com erro.` })
    recarregar()
  }

  const cartoes = ORDEM.map((s) => ({ chave: s, label: STATUS[s].label, valor: resumo[s] ?? 0 }))

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Gerar SKU no Bling</h1>
            <p className="text-sm text-muted-foreground">
              Produtos ativos do Bling sem código (SKU) recebem o código proposto. Só o campo <em>código</em> é alterado.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={recarregar} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Atualizar
          </Button>
        </div>

        {modoTeste && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Modo teste: nenhuma aplicação feita ainda</p>
              <p>
                Aplique primeiro em <strong>1 produto</strong> — o sistema lê o produto de volta no Bling pra confirmar que o código foi
                gravado. Só depois dessa confirmação o lote é liberado. Sugestão de produto de teste (sem vendas, fora da
                Nuvemshop): <strong>{PRODUTO_TESTE}</strong>.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {cartoes.map((c) => (
            <button
              key={c.chave}
              type="button"
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
          <Input placeholder="Buscar por nome ou código..." value={busca} onChange={(e) => comReset(setBusca)(e.target.value)} className="h-8 w-full sm:w-72" />
          <Select value={status} onValueChange={(v) => comReset(setStatus)(v)}>
            <SelectTrigger className="w-56" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {ORDEM.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!modoTeste && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Seleção em massa (todas as páginas):</span>
          <Button variant="outline" size="sm" disabled={selecionandoTodos || aplicando} onClick={() => handleSelecionarMassa('sem_vendas')}>
            {selecionandoTodos && <Loader2 className="h-4 w-4 animate-spin" />}
            Pendentes sem vendas
          </Button>
          <Button variant="outline" size="sm" disabled={selecionandoTodos || aplicando} onClick={() => handleSelecionarMassa('todas')}>
            Todas as pendentes
          </Button>
        </div>
      )}

      {selecionados.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-col gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            <span className="font-medium">{formatarNumero(selecionados.size)} selecionado(s)</span>
            {comVendas > 0 && <span className="text-muted-foreground"> · {formatarNumero(comVendas)} com vendas no histórico</span>}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelecionados(new Map())} disabled={aplicando}>
              <X className="h-4 w-4" />
              Limpar seleção
            </Button>
            <Button size="sm" onClick={() => setDialogAberto(true)} disabled={aplicando}>
              {modoTeste ? 'Testar no Bling (1 produto)' : `Revisar e gravar no Bling (${formatarNumero(selecionados.size)})`}
            </Button>
          </div>
        </div>
      )}

      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}

      <Card>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : linhas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma proposta neste filtro.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={estadoCabecalho}
                        onCheckedChange={(v) => handleToggleTodos(v === true)}
                        disabled={aplicando || modoTeste || aplicaveisNaPagina.length === 0}
                        aria-label="Selecionar todos da página"
                      />
                    </TableHead>
                    <TableHead>Produto no Bling</TableHead>
                    <TableHead>Código proposto</TableHead>
                    <TableHead>Observação</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((l) => {
                    const info = STATUS[l.status] ?? STATUS.pendente
                    const erroLocal = errosPorProduto[l.id_produto] ?? (l.status === 'erro' ? l.erro : null)
                    return (
                      <TableRow key={l.id_produto} data-state={selecionados.has(l.id_produto) ? 'selected' : undefined}>
                        <TableCell>
                          {aplicavel(l) && (
                            <Checkbox
                              checked={selecionados.has(l.id_produto)}
                              onCheckedChange={() => handleToggle(l)}
                              disabled={aplicando}
                              aria-label={`Selecionar ${l.nome ?? 'produto'}`}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <p className="max-w-80 truncate text-sm font-medium" title={l.nome ?? undefined}>
                            {l.nome || 'Produto sem nome'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            ID {l.id_produto}
                            {l.com_vendas && ' · com vendas'}
                          </p>
                        </TableCell>
                        <TableCell>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{l.codigo_proposto}</code>
                        </TableCell>
                        <TableCell className="max-w-56 text-xs text-muted-foreground">{l.observacao || '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.preco === null ? '—' : formatarMoeda(Number(l.preco))}</TableCell>
                        <TableCell>
                          <span className={cn('inline-flex h-5 items-center rounded-4xl px-2 text-xs font-medium whitespace-nowrap', info.classe)}>
                            {info.label}
                          </span>
                          {erroLocal && <p className="mt-1 max-w-64 text-xs text-destructive">{erroLocal}</p>}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Mostrando {inicio}–{fim} de {formatarNumero(totalRegistros)} itens
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Página {pagina} de {totalPaginas}
                  </span>
                  <Button variant="outline" size="sm" disabled={pagina >= totalPaginas} onClick={() => setPagina(pagina + 1)}>
                    Próxima
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogAberto} onOpenChange={(v) => !aplicando && setDialogAberto(v)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {modoTeste ? 'Teste no Bling com 1 produto' : `Gravar o código de ${lista.length} produto(s) no Bling`}
            </DialogTitle>
            <DialogDescription>
              O código proposto será gravado no cadastro do produto no Bling e lido de volta para confirmar. Nenhum outro campo
              (preço, estoque, nome) é alterado.
            </DialogDescription>
          </DialogHeader>

          {lista.length > ITENS_POR_LOTE && (
            <p className="text-xs text-muted-foreground">
              Cada produto leva ~2 s (ler, gravar e reler no Bling): estimativa de {Math.ceil((lista.length * 2) / 60)} min para {formatarNumero(lista.length)}{' '}
              produtos. Dá pra parar no meio; o que já foi gravado fica gravado.
            </p>
          )}

          {comVendas > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {comVendas} produto(s) já têm vendas. O código novo passa a aparecer nas notas e relatórios do Bling a partir de agora; o
                histórico do BI não muda (usa o ID do produto).
              </span>
            </div>
          )}

          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Código atual → novo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((l) => (
                  <TableRow key={l.id_produto}>
                    <TableCell className="max-w-80 truncate text-sm">{l.nome}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs">
                        <code className="rounded bg-muted px-1.5 py-0.5">vazio</code>
                        <span className="text-muted-foreground">→</span>
                        <code className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400">{l.codigo_proposto}</code>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {aplicando && (
            <div className="flex flex-col gap-2">
              <Progress value={progresso.total ? (progresso.feitos / progresso.total) * 100 : 0} />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Gravando no Bling: {progresso.feitos} de {progresso.total}... Não feche esta página.
                </p>
                <Button variant="outline" size="sm" onClick={() => (cancelarRef.current = true)}>
                  Parar após o lote atual
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogAberto(false)} disabled={aplicando}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmar} disabled={aplicando || lista.length === 0}>
              {aplicando && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar e gravar no Bling
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
