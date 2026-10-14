import type { CategoriaNuvemshop, MarcaNuvemshop } from '@/hooks/use-marca-categoria'

/** Mesma comparação do banco: maiúscula/minúscula e espaços nas pontas/duplicados não diferenciam. */
export function normalizarTexto(t: string | null | undefined): string {
  return (t ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Marcas sem repetição de grafia: cada marca aparece uma vez, com a grafia mais usada e a soma dos produtos. */
export function marcasUnicas(marcas: MarcaNuvemshop[]): MarcaNuvemshop[] {
  const grupos = new Map<string, MarcaNuvemshop[]>()
  for (const m of marcas) {
    const chave = normalizarTexto(m.nome)
    grupos.set(chave, [...(grupos.get(chave) ?? []), m])
  }
  const unicas = [...grupos.values()].map((grupo) => {
    const principal = grupo.reduce((a, b) => (b.qtd_produtos > a.qtd_produtos ? b : a))
    return { ...principal, nome: principal.nome.trim(), qtd_produtos: grupo.reduce((soma, m) => soma + m.qtd_produtos, 0) }
  })
  return unicas.sort((a, b) => normalizarTexto(a.nome).localeCompare(normalizarTexto(b.nome), 'pt-BR'))
}

/** Categoria com recuo pelo nível, pra listas planas que parecem uma árvore. */
export function rotuloCategoria(c: Pick<CategoriaNuvemshop, 'nome' | 'nivel'>): string {
  return `${'   '.repeat(Math.max(0, c.nivel - 1))}${c.nome.trim()}`
}
