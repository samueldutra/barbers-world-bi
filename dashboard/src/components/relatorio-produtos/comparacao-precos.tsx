'use client'

import { AlertTriangle, ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ProdutoImagem } from '@/components/produto-imagem'
import { pareceEan } from '@/lib/comparar-precos/comparar'
import type { ResultadoComparacao } from '@/lib/comparar-precos/tipos'
import { formatarMoeda } from '@/lib/formatters'

interface Props {
  dados: ResultadoComparacao | null
  loading: boolean
  erro: string | null
  onBuscar: (opcoes?: { consulta?: string; forcar?: boolean }) => void
}

function haQuanto(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (min < 1) return 'agora há pouco'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} dia(s)`
}

function mediana(valores: number[]): number {
  const v = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(v.length / 2)
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2
}

/** Diferença do preço do concorrente em relação ao nosso: negativa = ele é mais barato. */
function Diferenca({ concorrente, nosso }: { concorrente: number; nosso: number | null }) {
  if (!nosso || nosso <= 0) return null
  const pct = ((concorrente - nosso) / nosso) * 100
  if (Math.abs(pct) < 0.5) return <span className="text-xs text-muted-foreground">igual ao seu</span>
  const maisBarato = pct < 0
  return (
    <span className={`text-xs font-medium tabular-nums ${maisBarato ? 'text-destructive' : 'text-emerald-600'}`}>
      {maisBarato ? '−' : '+'}
      {Math.abs(pct).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% {maisBarato ? 'mais barato' : 'mais caro'}
    </span>
  )
}

/** Aba "Comparar preços": ofertas de outras lojas (Google Shopping) com valor e link. */
export function ComparacaoPrecos({ dados, loading, erro, onBuscar }: Props) {
  if (loading && !dados) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Buscando preços no Google Shopping...
        </p>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (erro && !dados) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <p className="flex items-start gap-2 text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {erro}
        </p>
        <Button variant="outline" size="sm" onClick={() => onBuscar()}>
          <RefreshCw className="h-4 w-4" />
          Tentar de novo
        </Button>
      </div>
    )
  }

  if (!dados) return null

  const nosso = dados.produto.preco
  const precos = dados.itens.map((i) => i.preco)
  const menor = precos.length ? Math.min(...precos) : null

  return (
    <div className="flex flex-col gap-4">
      {/* Resumo */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Seu preço</p>
          <p className="text-base font-semibold tabular-nums">{nosso != null ? formatarMoeda(nosso) : '—'}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Menor encontrado</p>
          <p className="text-base font-semibold tabular-nums">{menor != null ? formatarMoeda(menor) : '—'}</p>
          {menor != null && <Diferenca concorrente={menor} nosso={nosso} />}
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Mediana ({dados.itens.length})</p>
          <p className="text-base font-semibold tabular-nums">{precos.length ? formatarMoeda(mediana(precos)) : '—'}</p>
          {precos.length > 0 && <Diferenca concorrente={mediana(precos)} nosso={nosso} />}
        </div>
      </div>

      {/* O que foi buscado — o texto pode ser refinado (cada busca nova gasta 1 busca paga). */}
      <form
        key={dados.consulta}
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const texto = String(new FormData(e.currentTarget).get('consulta') ?? '').trim()
          if (texto) onBuscar({ consulta: texto })
        }}
      >
        <label htmlFor="consulta-precos" className="text-xs text-muted-foreground">
          Texto buscado no Google Shopping
        </label>
        <div className="flex gap-2">
          <Input id="consulta-precos" name="consulta" defaultValue={dados.consulta} maxLength={120} className="h-8" />
          <Button type="submit" size="sm" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Buscar
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {pareceEan(dados.produto.codigo) && dados.consulta !== dados.produto.codigo?.trim() && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={loading}
              onClick={() => onBuscar({ consulta: dados.produto.codigo!.trim() })}
            >
              Buscar pelo EAN {dados.produto.codigo}
            </Button>
          )}
          <span>
            Consultado {haQuanto(dados.consultadoEm)}
            {dados.doCache ? ' (resultado guardado, sem nova busca)' : ''}
          </span>
          <Button type="button" variant="ghost" size="xs" disabled={loading} onClick={() => onBuscar({ consulta: dados.consulta, forcar: true })}>
            <RefreshCw className="h-3 w-3" />
            Atualizar
          </Button>
        </div>
      </form>

      {dados.limiteAtingido && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
          O limite diário de buscas foi atingido; mostrando a última consulta guardada.
        </p>
      )}
      {erro && <p className="text-xs text-destructive">{erro}</p>}

      {/* Ofertas */}
      {dados.itens.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhuma oferta de outras lojas encontrada. Tente mudar o texto da busca ou buscar pelo EAN.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {dados.itens.map((item, i) => (
            <li key={`${item.loja}-${item.preco}-${i}`} className="flex items-center gap-3 rounded-lg border p-3">
              <ProdutoImagem src={item.thumbnail} alt="" tamanho={44} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm leading-snug">{item.titulo}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="max-w-40 truncate">
                    {item.loja ?? 'Loja'}
                  </Badge>
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="text-sm font-semibold tabular-nums">{formatarMoeda(item.preco)}</span>
                <Diferenca concorrente={item.preco} nosso={nosso} />
              </div>
              {item.link ? (
                <Button variant="outline" size="icon-sm" asChild aria-label={`Abrir oferta da ${item.loja ?? 'loja'}`}>
                  <a href={item.link} target="_blank" rel="noopener noreferrer">
                    <ExternalLink />
                  </a>
                </Button>
              ) : (
                <span className="size-7 shrink-0" />
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Resultados do Google Shopping, ordenados pelo menor preço. Confira se é o mesmo produto (modelo, tamanho,
        kit) antes de comparar. A sua loja não aparece na lista.
      </p>
    </div>
  )
}
