/** Módulos do BI que podem ser liberados por usuário (tela de Usuários).
 * "Usuários" em si não é um módulo liberável — é exclusivo de super admin. */

export interface SystemModule {
  id: string
  label: string
  url: string
}

export const SYSTEM_MODULES: SystemModule[] = [
  { id: 'dashboard', label: 'Dashboard', url: '/dashboard' },
  { id: 'relatorio-produtos', label: 'Relatório de Vendas por Produto', url: '/relatorio-produtos' },
  { id: 'relatorio-clientes', label: 'Relatório de Vendas por Cliente', url: '/relatorio-clientes' },
  { id: 'prospeccao', label: 'Prospecção de Leads', url: '/prospeccao' },
]

export const MODULE_IDS: string[] = SYSTEM_MODULES.map((m) => m.id)

export function isValidModule(id: string): boolean {
  return MODULE_IDS.includes(id)
}

export function moduleLabel(id: string): string {
  return SYSTEM_MODULES.find((m) => m.id === id)?.label ?? id
}

/** Módulo pro caminho atual (prefixo mais específico primeiro), ou null se não mapeado
 * (rota fora da lista de módulos liberáveis — ex.: /usuarios, sempre exclusiva de super admin). */
export function moduleForPath(pathname: string): SystemModule | null {
  return (
    SYSTEM_MODULES.filter((m) => pathname === m.url || pathname.startsWith(`${m.url}/`)).sort(
      (a, b) => b.url.length - a.url.length
    )[0] ?? null
  )
}
