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
    return dados as { id: string; email: string }
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

  return { usuarios, loading, error, recarregar: carregar, criar, atualizar, excluir }
}
