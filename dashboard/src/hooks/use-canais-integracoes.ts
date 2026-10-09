'use client'

import { useCallback, useEffect, useState } from 'react'

export interface CanalIntegracao {
  id: string
  plataforma: 'nuvemshop'
  nome: string
  status: 'pendente' | 'conectado' | 'erro'
  store_id: string | null
  store_nome: string | null
  store_url: string | null
  scope: string | null
  ultimo_erro: string | null
  created_at: string
  conectado_em: string | null
}

export interface ConfigNuvemshop {
  /** Variáveis de ambiente que faltam no servidor. */
  faltando: string[]
  redirectUri: string | null
}

async function chamar<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init)
  const corpo = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(corpo?.error ?? `Erro ${resp.status}`)
  return corpo as T
}

export function useCanaisIntegracoes() {
  const [canais, setCanais] = useState<CanalIntegracao[]>([])
  const [config, setConfig] = useState<ConfigNuvemshop | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const d = await chamar<{ canais: CanalIntegracao[]; nuvemshop: ConfigNuvemshop }>('/api/canais-venda')
      setCanais(d.canais)
      setConfig(d.nuvemshop)
      setErro(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar os canais.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  /** Cadastra o canal e devolve a URL de autorização da Nuvemshop. */
  const cadastrar = async (nome: string): Promise<string> => {
    const d = await chamar<{ urlAutorizacao: string }>('/api/canais-venda', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plataforma: 'nuvemshop', nome }),
    })
    return d.urlAutorizacao
  }

  const reconectar = async (id: string): Promise<string> =>
    (await chamar<{ urlAutorizacao: string }>(`/api/canais-venda/${id}`, { method: 'POST' })).urlAutorizacao

  const excluir = async (id: string) => {
    await chamar(`/api/canais-venda/${id}`, { method: 'DELETE' })
    setCanais((atual) => atual.filter((c) => c.id !== id))
  }

  return { canais, config, loading, erro, cadastrar, reconectar, excluir, recarregar: carregar }
}
