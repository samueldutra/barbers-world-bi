'use client'

import { useCallback, useEffect, useState } from 'react'

export interface Usuario {
  id: string
  email: string
  full_name: string | null
  is_superadmin: boolean
  is_active: boolean
  created_at: string
  modules: string[]
  ultimo_acesso: string | null
  /** Ainda não aceitou o convite / nunca entrou. */
  convite_pendente: boolean
}

export interface ResultadoCriacao {
  id: string
  email: string
  emailEnviado: boolean
  erroEmail: string | null
  /** Só quando o email não saiu — o admin manda o link por outro canal. */
  linkAcesso: string | null
}

export interface CriarUsuarioInput {
  email: string
  full_name: string
  is_superadmin: boolean
  modules: string[]
}

export interface AtualizarUsuarioInput {
  full_name?: string
  is_superadmin?: boolean
  is_active?: boolean
  modules?: string[]
}

export function useUsuarios() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resposta = await fetch('/api/usuarios')
      const dados = await resposta.json()
      if (!resposta.ok) throw new Error(dados.error || 'Erro ao carregar usuários')
      setUsuarios((dados.usuarios as Usuario[]) ?? [])
    } catch (err) {
      console.error('Erro ao carregar usuários:', err)
      setError('Não foi possível carregar os usuários.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  const criar = async (input: CriarUsuarioInput) => {
    const resposta = await fetch('/api/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const dados = await resposta.json()
    if (!resposta.ok) throw new Error(dados.error || 'Erro ao criar usuário')
    await carregar()
    return dados as ResultadoCriacao
  }

  const atualizar = async (id: string, input: AtualizarUsuarioInput) => {
    const resposta = await fetch(`/api/usuarios/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const dados = await resposta.json()
    if (!resposta.ok) throw new Error(dados.error || 'Erro ao atualizar usuário')
    await carregar()
  }

  const excluir = async (id: string) => {
    const resposta = await fetch(`/api/usuarios/${id}`, { method: 'DELETE' })
    const dados = await resposta.json()
    if (!resposta.ok) throw new Error(dados.error || 'Erro ao excluir usuário')
    await carregar()
  }

  /** Novo acesso pra um usuário existente: link pra copiar (enviarEmail=false) ou email. */
  const gerarAcesso = async (id: string, enviarEmail: boolean) => {
    const resposta = await fetch(`/api/usuarios/${id}/acesso`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enviar_email: enviarEmail }),
    })
    const dados = await resposta.json().catch(() => ({}))
    if (!resposta.ok) throw new Error(dados.error || 'Erro ao gerar acesso')
    return dados as { emailEnviado: boolean; link: string | null }
  }

  return { usuarios, loading, error, recarregar: carregar, criar, atualizar, excluir, gerarAcesso }
}
