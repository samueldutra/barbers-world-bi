'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ResultadoComparacao } from '@/lib/comparar-precos/tipos'

interface Opcoes {
  /** Texto da busca escolhido pelo usuário (senão o servidor monta a partir do produto). */
  consulta?: string
  /** Ignora o cache de 24 h e faz uma busca nova (gasta 1 busca paga). */
  forcar?: boolean
}

// Evita pedido duplicado enquanto um igual está em andamento (React Strict Mode roda o efeito 2x em
// desenvolvimento, e cada pedido sem cache é uma busca paga).
const emAndamento = new Map<string, Promise<ResultadoComparacao>>()

function pedir(idProduto: number, opcoes: Opcoes): Promise<ResultadoComparacao> {
  const chave = `${idProduto}|${opcoes.consulta ?? ''}|${opcoes.forcar ? 1 : 0}`
  const existente = emAndamento.get(chave)
  if (existente) return existente

  const promessa = (async () => {
    const resposta = await fetch('/api/produtos/comparar-precos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idProduto, consulta: opcoes.consulta, forcar: opcoes.forcar }),
    })
    const corpo = await resposta.json().catch(() => ({}))
    if (!resposta.ok) throw new Error(corpo.error || 'Não foi possível comparar os preços agora.')
    return corpo as ResultadoComparacao
  })().finally(() => emAndamento.delete(chave))

  emAndamento.set(chave, promessa)
  return promessa
}

/** Compara o preço do produto com a concorrência. Busca assim que o produto é aberto (idProduto
 * muda); `buscar` refaz a busca com outro texto ou ignorando o cache. */
export function useComparacaoPrecos(idProduto: number | null) {
  const [dados, setDados] = useState<ResultadoComparacao | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const pedidoAtual = useRef(0)

  const buscar = useCallback(
    async (opcoes: Opcoes = {}) => {
      if (idProduto == null) return
      const numero = ++pedidoAtual.current
      setLoading(true)
      setErro(null)
      try {
        const resultado = await pedir(idProduto, opcoes)
        if (numero === pedidoAtual.current) setDados(resultado)
      } catch (err) {
        if (numero === pedidoAtual.current) setErro(err instanceof Error ? err.message : 'Erro ao comparar os preços.')
      } finally {
        if (numero === pedidoAtual.current) setLoading(false)
      }
    },
    [idProduto]
  )

  useEffect(() => {
    pedidoAtual.current++ // descarta resposta de um produto aberto antes
    setDados(null)
    setErro(null)
    if (idProduto == null) {
      setLoading(false)
      return
    }
    buscar()
  }, [idProduto, buscar])

  return { dados, loading, erro, buscar }
}
