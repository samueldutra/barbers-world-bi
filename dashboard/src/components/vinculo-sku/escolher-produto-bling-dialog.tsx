'use client'

import { useEffect, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from 'cn'
import { formatarMoeda } from '@/lib/formatters'
import { createClient } from '@/lib/supabase/client'
import { TENANT_SCHEMA } from '@/lib/tenant'
import type { LinhaVinculo } from '@/hooks/use-vinculo-sku'

export interface ProdutoBlingBusca {
  id_produto: number
  codigo: string
  nome: string
  preco: number | null
  formato: string | null
  /** Quantas variantes da Nuvemshop já usam este código (> 0 = já vinculado). */
  qtd_variantes_ns: number
  /** Similaridade com o nome do produto da Nuvemshop (0 a 1). */
  score: number | null
}

interface Props {
  /** Variante da Nuvemshop que está sendo vinculada; null = fechado. */
  linha: LinhaVinculo | null
  onOpenChange: (aberto: boolean) => void
  onEscolher: (linha: LinhaVinculo, produto: ProdutoBlingBusca) => void
}

/** Pesquisa produtos ATIVOS do Bling (por palavras do nome ou do código) e deixa escolher o par da variante.
 * Sem busca, lista os de nome mais parecido com o produto da Nuvemshop. Quem já está vinculado a outra variante
 * aparece desabilitado: gravar o mesmo SKU em duas variantes duplicaria o SKU na loja. */
export function EscolherProdutoBlingDialog({ linha, onOpenChange, onEscolher }: Props) {
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<ProdutoBlingBusca[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const referencia = linha ? [linha.nome_ns, linha.variacao_ns].filter(Boolean).join(' ') : ''
  const idVariante = linha?.id_variante ?? null

  // Ao abrir pra outra variante, volta a busca ao vazio (lista por similaridade).
  useEffect(() => {
    setBusca('')
  }, [idVariante])

  useEffect(() => {
    if (!linha) return
    let ativo = true
    setCarregando(true)
    setErro(null)
    const supabase = createClient()
    const timer = setTimeout(() => {
      Promise.resolve(
        supabase.rpc('buscar_produtos_bling', {
          p_schema_name: TENANT_SCHEMA,
          p_busca: busca.trim() || null,
          p_referencia: referencia || null,
          p_limite: 30,
        })
      )
        .then(({ data, error }) => {
          if (!ativo) return
          if (error) throw error
          setResultados((data as ProdutoBlingBusca[]) ?? [])
        })
        .catch((e) => {
          console.error('Erro ao buscar produtos do Bling:', e)
          if (ativo) setErro('Não foi possível buscar no Bling.')
        })
        .finally(() => {
          if (ativo) setCarregando(false)
        })
    }, 300)
    return () => {
      ativo = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idVariante, busca])

  return (
    <Dialog open={linha !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Escolher o produto do Bling</DialogTitle>
          <DialogDescription>
            O SKU desta variante na Nuvemshop passará a ser o código do produto escolhido.
          </DialogDescription>
        </DialogHeader>

        {linha && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{linha.nome_ns || 'Produto sem nome'}</p>
            <p className="text-xs text-muted-foreground">
              {linha.variacao_ns && `${linha.variacao_ns} · `}SKU atual:{' '}
              <code className="rounded bg-muted px-1.5 py-0.5">{linha.sku_ns ? `"${linha.sku_ns}"` : 'sem SKU'}</code>
            </p>
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Pesquisar por nome ou código no Bling..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-8"
          />
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          {busca.trim() ? 'Resultados da pesquisa (todas as palavras precisam aparecer).' : 'Mais parecidos com o nome na Nuvemshop:'}
        </p>

        <div className="max-h-96 overflow-y-auto rounded-md border">
          {carregando && resultados.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando...
            </div>
          ) : erro ? (
            <p className="p-6 text-center text-sm text-destructive">{erro}</p>
          ) : resultados.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Nenhum produto encontrado.</p>
          ) : (
            <ul className={cn('divide-y', carregando && 'opacity-60')}>
              {resultados.map((p) => {
                const ocupado = p.qtd_variantes_ns > 0
                return (
                  <li key={p.id_produto}>
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => linha && onEscolher(linha, p)}
                      className="flex w-full items-start justify-between gap-3 p-3 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.nome}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <code className="rounded bg-muted px-1.5 py-0.5">{p.codigo}</code>
                          {p.preco !== null && <span>{formatarMoeda(Number(p.preco))}</span>}
                          {ocupado && (
                            <span className="rounded-4xl bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400">
                              já vinculado a {p.qtd_variantes_ns} variante(s) da Nuvemshop
                            </span>
                          )}
                        </p>
                      </div>
                      {p.score !== null && (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" title="Similaridade de nome">
                          {Math.round(Number(p.score) * 100)}%
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
