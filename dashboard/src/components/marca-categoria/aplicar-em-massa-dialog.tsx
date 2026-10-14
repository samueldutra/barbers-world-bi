'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from 'cn'
import { formatarNumero } from '@/lib/formatters'
import { marcasUnicas, normalizarTexto, rotuloCategoria } from '@/lib/marca-categoria'
import type { ResultadoMarcaCategoria } from '@/app/api/marca-categoria/alterar/route'
import type { CategoriaNuvemshop, MarcaNuvemshop, ProdutoMarcaCategoria } from '@/hooks/use-marca-categoria'
import { NovaCategoriaForm } from './nova-categoria-form'

const ITENS_POR_LOTE = 15 // mesmo limite da rota /api/marca-categoria/alterar

type ModoMarca = 'nao' | 'definir' | 'limpar'
type ModoCategorias = 'nao' | 'adicionar' | 'substituir' | 'remover' | 'limpar'

export interface ResumoAplicacao {
  sucessos: number
  semAlteracao: number
  falhas: { id: number; nome: string; erro: string }[]
}

interface Props {
  aberto: boolean
  onOpenChange: (aberto: boolean) => void
  produtos: ProdutoMarcaCategoria[]
  marcas: MarcaNuvemshop[]
  categorias: CategoriaNuvemshop[]
  /** Pede ao pai pra recarregar as categorias (uma nova foi criada aqui dentro). */
  onCategoriaCriada: () => void
  /** Terminou de aplicar: resultados por produto (o pai tira da seleção os que deram certo e recarrega a lista). */
  onAplicado: (resultados: ResultadoMarcaCategoria[]) => void
}

export function AplicarEmMassaDialog({ aberto, onOpenChange, produtos, marcas, categorias, onCategoriaCriada, onAplicado }: Props) {
  const [modoMarca, setModoMarca] = useState<ModoMarca>('nao')
  const [marcaTexto, setMarcaTexto] = useState('')
  const [modoCat, setModoCat] = useState<ModoCategorias>('nao')
  const [catIds, setCatIds] = useState<Set<number>>(new Set())
  const [buscaCat, setBuscaCat] = useState('')
  const [aplicando, setAplicando] = useState(false)
  const [progresso, setProgresso] = useState({ feitos: 0, total: 0 })
  const [resumo, setResumo] = useState<ResumoAplicacao | null>(null)

  const unicas = useMemo(() => marcasUnicas(marcas), [marcas])
  const marcaDigitada = marcaTexto.trim().replace(/\s+/g, ' ')
  const marcaExistente = unicas.find((m) => normalizarTexto(m.nome) === normalizarTexto(marcaDigitada))
  const sugestoesMarca = useMemo(() => {
    const t = normalizarTexto(marcaDigitada)
    return unicas.filter((m) => t === '' || normalizarTexto(m.nome).includes(t)).slice(0, 8)
  }, [unicas, marcaDigitada])
  const categoriasFiltradas = useMemo(() => {
    const t = normalizarTexto(buscaCat)
    return categorias.filter((c) => t === '' || normalizarTexto(c.caminho).includes(t))
  }, [categorias, buscaCat])

  const precisaCategorias = modoCat === 'adicionar' || modoCat === 'substituir' || modoCat === 'remover'
  const marcaValida = modoMarca !== 'definir' || marcaDigitada.length > 0
  const catValida = !precisaCategorias || catIds.size > 0
  const algoParaFazer = modoMarca !== 'nao' || modoCat !== 'nao'
  const podeAplicar = algoParaFazer && marcaValida && catValida && produtos.length > 0 && !aplicando

  const nomesCategoriasEscolhidas = categorias.filter((c) => catIds.has(c.id_categoria)).map((c) => c.nome.trim())
  // A marca digitada com grafia diferente de uma existente usa a grafia existente (evita criar "Wahl" ao lado de "WAHL").
  const marcaFinal = marcaExistente ? marcaExistente.nome : marcaDigitada

  const descricao: string[] = []
  if (modoMarca === 'definir') descricao.push(`marca definida como "${marcaFinal}"${marcaExistente ? '' : ' (marca nova)'}`)
  if (modoMarca === 'limpar') descricao.push('marca removida')
  if (modoCat === 'adicionar') descricao.push(`categorias adicionadas: ${nomesCategoriasEscolhidas.join(', ')}`)
  if (modoCat === 'substituir') descricao.push(`categorias substituídas por: ${nomesCategoriasEscolhidas.join(', ')}`)
  if (modoCat === 'remover') descricao.push(`categorias removidas: ${nomesCategoriasEscolhidas.join(', ')}`)
  if (modoCat === 'limpar') descricao.push('todas as categorias removidas')

  const toggleCat = (id: number) =>
    setCatIds((atual) => {
      const novo = new Set(atual)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })

  const aplicar = async (alvo: ProdutoMarcaCategoria[]) => {
    setAplicando(true)
    setResumo(null)
    setProgresso({ feitos: 0, total: alvo.length })
    const resultados: ResultadoMarcaCategoria[] = []
    let lotesSeguidosComFalhaTotal = 0

    for (let i = 0; i < alvo.length; i += ITENS_POR_LOTE) {
      const lote = alvo.slice(i, i + ITENS_POR_LOTE)
      try {
        const resp = await fetch('/api/marca-categoria/alterar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itens: lote.map((p) => ({ store_id: p.store_id, id_produto_ns: p.id_produto_ns })),
            marca: modoMarca === 'definir' ? { acao: 'definir', valor: marcaFinal } : modoMarca === 'limpar' ? { acao: 'limpar' } : undefined,
            categorias: modoCat === 'nao' ? undefined : { acao: modoCat, ids: precisaCategorias ? [...catIds] : [] },
          }),
        })
        const corpo = await resp.json().catch(() => null)
        if (!resp.ok) throw new Error(corpo?.error || `Erro ${resp.status}`)
        // Sessão expirada: o middleware redireciona /api/* pra /login e o fetch recebe HTML.
        if (!Array.isArray(corpo?.resultados)) throw new Error('Sessão expirada — entre novamente e repita.')
        resultados.push(...(corpo.resultados as ResultadoMarcaCategoria[]))
      } catch (e) {
        const mensagem = e instanceof Error ? e.message : 'Falha na comunicação com o servidor.'
        resultados.push(...lote.map((p) => ({ id_produto_ns: p.id_produto_ns, sucesso: false, alterado: false, marca: null, categorias_ids: [], erro: mensagem })))
      }
      setProgresso({ feitos: Math.min(i + lote.length, alvo.length), total: alvo.length })
      // Trava: dois lotes seguidos 100% com erro = algo está errado (token, permissão, limite) — não insiste.
      const ultimos = resultados.slice(-lote.length)
      lotesSeguidosComFalhaTotal = ultimos.every((r) => !r.sucesso) ? lotesSeguidosComFalhaTotal + 1 : 0
      if (lotesSeguidosComFalhaTotal >= 2) {
        const naoTentados = alvo.slice(i + ITENS_POR_LOTE)
        resultados.push(...naoTentados.map((p) => ({ id_produto_ns: p.id_produto_ns, sucesso: false, alterado: false, marca: null, categorias_ids: [], erro: 'Interrompido: dois lotes seguidos deram erro.' })))
        break
      }
    }

    const nomePor = new Map(alvo.map((p) => [p.id_produto_ns, p.nome ?? `Produto ${p.id_produto_ns}`]))
    setResumo({
      sucessos: resultados.filter((r) => r.sucesso && r.alterado).length,
      semAlteracao: resultados.filter((r) => r.sucesso && !r.alterado).length,
      falhas: resultados.filter((r) => !r.sucesso).map((r) => ({ id: r.id_produto_ns, nome: nomePor.get(r.id_produto_ns) ?? String(r.id_produto_ns), erro: r.erro ?? 'Erro' })),
    })
    setAplicando(false)
    onAplicado(resultados)
  }

  const fechar = (v: boolean) => {
    if (aplicando) return
    if (!v) setResumo(null)
    onOpenChange(v)
  }

  return (
    <Dialog open={aberto} onOpenChange={fechar}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Aplicar marca e categoria em {formatarNumero(produtos.length)} produto(s)</DialogTitle>
          <DialogDescription>
            Só a marca e as categorias são alteradas na Nuvemshop — preço, estoque, SKU e demais dados não mudam. A alteração
            vale na loja na hora.
          </DialogDescription>
        </DialogHeader>

        {resumo ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border p-3">
                <p className="text-xl font-semibold tabular-nums text-emerald-600">{formatarNumero(resumo.sucessos)}</p>
                <p className="text-xs text-muted-foreground">alterados</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xl font-semibold tabular-nums">{formatarNumero(resumo.semAlteracao)}</p>
                <p className="text-xs text-muted-foreground">já estavam assim</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className={cn('text-xl font-semibold tabular-nums', resumo.falhas.length > 0 && 'text-destructive')}>{formatarNumero(resumo.falhas.length)}</p>
                <p className="text-xs text-muted-foreground">com erro</p>
              </div>
            </div>
            {resumo.falhas.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                {resumo.falhas.map((f) => (
                  <p key={f.id} className="py-0.5">
                    <span className="font-medium">{f.nome}</span>
                    <span className="text-muted-foreground"> — {f.erro}</span>
                  </p>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => fechar(false)}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <section className="flex flex-col gap-2 rounded-lg border p-3">
                <h3 className="text-sm font-medium">Marca</h3>
                <Select value={modoMarca} onValueChange={(v) => setModoMarca(v as ModoMarca)} disabled={aplicando}>
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nao">Não alterar a marca</SelectItem>
                    <SelectItem value="definir">Definir a marca</SelectItem>
                    <SelectItem value="limpar">Remover a marca</SelectItem>
                  </SelectContent>
                </Select>
                {modoMarca === 'definir' && (
                  <>
                    <Input
                      placeholder="Digite ou escolha a marca"
                      value={marcaTexto}
                      maxLength={100}
                      onChange={(e) => setMarcaTexto(e.target.value)}
                      disabled={aplicando}
                      className="h-8"
                    />
                    <div className="max-h-40 overflow-y-auto rounded-md border">
                      {sugestoesMarca.map((m) => (
                        <button
                          key={m.nome}
                          type="button"
                          onClick={() => setMarcaTexto(m.nome)}
                          className={cn('flex w-full items-center justify-between px-2 py-1.5 text-left text-sm hover:bg-muted', marcaExistente?.nome === m.nome && 'bg-muted')}
                        >
                          <span className="truncate">{m.nome}</span>
                          <span className="ml-2 shrink-0 text-xs text-muted-foreground">{formatarNumero(m.qtd_produtos)}</span>
                        </button>
                      ))}
                      {marcaDigitada && !marcaExistente && (
                        <p className="flex items-center gap-1 px-2 py-1.5 text-sm text-emerald-700 dark:text-emerald-400">
                          <Plus className="h-3.5 w-3.5" /> Criar a marca nova &quot;{marcaDigitada}&quot;
                        </p>
                      )}
                    </div>
                    {marcaExistente && marcaExistente.nome !== marcaDigitada && (
                      <p className="text-xs text-muted-foreground">Vai usar a grafia já existente: &quot;{marcaExistente.nome}&quot;.</p>
                    )}
                  </>
                )}
              </section>

              <section className="flex flex-col gap-2 rounded-lg border p-3">
                <h3 className="text-sm font-medium">Categorias</h3>
                <Select value={modoCat} onValueChange={(v) => setModoCat(v as ModoCategorias)} disabled={aplicando}>
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nao">Não alterar as categorias</SelectItem>
                    <SelectItem value="adicionar">Adicionar às que já tem</SelectItem>
                    <SelectItem value="substituir">Substituir todas por estas</SelectItem>
                    <SelectItem value="remover">Remover estas</SelectItem>
                    <SelectItem value="limpar">Remover todas as categorias</SelectItem>
                  </SelectContent>
                </Select>
                {precisaCategorias && (
                  <>
                    <Input placeholder="Buscar categoria..." value={buscaCat} onChange={(e) => setBuscaCat(e.target.value)} disabled={aplicando} className="h-8" />
                    <div className="max-h-48 overflow-y-auto rounded-md border">
                      {categoriasFiltradas.map((c) => (
                        <label key={c.id_categoria} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-muted">
                          <Checkbox checked={catIds.has(c.id_categoria)} onCheckedChange={() => toggleCat(c.id_categoria)} disabled={aplicando} />
                          <span className="truncate" title={c.caminho}>
                            {buscaCat ? c.caminho : rotuloCategoria(c)}
                          </span>
                        </label>
                      ))}
                      {categoriasFiltradas.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nenhuma categoria encontrada.</p>}
                    </div>
                    <p className="text-xs text-muted-foreground">{catIds.size} selecionada(s)</p>
                  </>
                )}
              </section>
            </div>

            <details className="rounded-lg border p-3 text-sm">
              <summary className="cursor-pointer font-medium">Criar uma categoria nova</summary>
              <div className="mt-3">
                <NovaCategoriaForm
                  categorias={categorias}
                  desabilitado={aplicando}
                  onCriada={(id) => {
                    onCategoriaCriada()
                    setCatIds((atual) => new Set(atual).add(id))
                  }}
                />
              </div>
            </details>

            {algoParaFazer && marcaValida && catValida && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Em {formatarNumero(produtos.length)} produto(s): {descricao.join('; ')}.
                  {produtos.length > 1 && ' Dica: confira o resultado em 1 produto antes de aplicar nos demais.'}
                </span>
              </div>
            )}

            {aplicando && (
              <div className="flex flex-col gap-2">
                <Progress value={progresso.total ? (progresso.feitos / progresso.total) * 100 : 0} />
                <p className="text-xs text-muted-foreground">
                  Gravando na Nuvemshop: {progresso.feitos} de {progresso.total}...
                </p>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => fechar(false)} disabled={aplicando}>
                Cancelar
              </Button>
              {produtos.length > 1 && (
                <Button variant="outline" onClick={() => aplicar(produtos.slice(0, 1))} disabled={!podeAplicar}>
                  Testar em 1 produto
                </Button>
              )}
              <Button onClick={() => aplicar(produtos)} disabled={!podeAplicar}>
                {aplicando && <Loader2 className="h-4 w-4 animate-spin" />}
                Aplicar em {formatarNumero(produtos.length)}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
