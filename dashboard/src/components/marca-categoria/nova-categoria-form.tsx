'use client'

import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CategoriaNuvemshop } from '@/hooks/use-marca-categoria'
import { rotuloCategoria } from '@/lib/marca-categoria'

const TOPO = '__topo__'

interface Props {
  categorias: CategoriaNuvemshop[]
  /** Chamado depois de criar (a lista de categorias deve ser recarregada). */
  onCriada: (id: number, nome: string) => void
  desabilitado?: boolean
}

/** Cria uma categoria na Nuvemshop (nome + categoria pai opcional). */
export function NovaCategoriaForm({ categorias, onCriada, desabilitado }: Props) {
  const [nome, setNome] = useState('')
  const [pai, setPai] = useState<string>(TOPO)
  const [criando, setCriando] = useState(false)

  const criar = async () => {
    const texto = nome.trim()
    if (!texto) return
    setCriando(true)
    try {
      const resp = await fetch('/api/marca-categoria/categorias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: texto, id_pai: pai === TOPO ? null : Number(pai) }),
      })
      const corpo = await resp.json().catch(() => null)
      if (!resp.ok) throw new Error(corpo?.error || `Erro ${resp.status}`)
      if (typeof corpo?.id !== 'number') throw new Error('Sessão expirada — entre novamente e repita.')
      toast.success(`Categoria "${corpo.nome}" criada na Nuvemshop.`)
      setNome('')
      onCriada(corpo.id, corpo.nome)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível criar a categoria.')
    } finally {
      setCriando(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input
        placeholder="Nome da nova categoria"
        value={nome}
        maxLength={100}
        onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && criar()}
        disabled={desabilitado || criando}
        className="h-8 sm:w-64"
      />
      <Select value={pai} onValueChange={setPai} disabled={desabilitado || criando}>
        <SelectTrigger size="sm" className="sm:w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={TOPO}>Categoria de topo (sem pai)</SelectItem>
          {categorias.map((c) => (
            <SelectItem key={c.id_categoria} value={String(c.id_categoria)}>
              {rotuloCategoria(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" onClick={criar} disabled={desabilitado || criando || nome.trim() === ''}>
        {criando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Criar categoria
      </Button>
    </div>
  )
}
