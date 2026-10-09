import type { StatusLead } from '@/hooks/use-leads-mapeados'

/** Fonte única das classificações de lead: rótulo, cor no mapa e estilo do botão ativo. */
export const STATUS_LEAD: Record<StatusLead, { label: string; cor: string; classeAtivo: string; variante: 'default' | 'secondary' | 'outline' }> = {
  pendente: { label: 'A classificar', cor: '#0ea5e9', classeAtivo: 'data-[ativo=true]:bg-sky-500 data-[ativo=true]:text-white data-[ativo=true]:border-sky-500', variante: 'outline' },
  cliente: { label: 'Cliente', cor: '#102694', classeAtivo: 'data-[ativo=true]:bg-primary data-[ativo=true]:text-primary-foreground data-[ativo=true]:border-primary', variante: 'default' },
  concorrente: { label: 'Concorrente', cor: '#78716c', classeAtivo: 'data-[ativo=true]:bg-stone-500 data-[ativo=true]:text-white data-[ativo=true]:border-stone-500', variante: 'outline' },
  lead: { label: 'Lead', cor: '#f59e0b', classeAtivo: 'data-[ativo=true]:bg-amber-500 data-[ativo=true]:text-white data-[ativo=true]:border-amber-500', variante: 'secondary' },
  cliente_bw: { label: 'Cliente BW', cor: '#0f766e', classeAtivo: 'data-[ativo=true]:bg-teal-700 data-[ativo=true]:text-white data-[ativo=true]:border-teal-700', variante: 'default' },
  cliente_anderson: { label: 'Cliente Anderson', cor: '#db2777', classeAtivo: 'data-[ativo=true]:bg-pink-600 data-[ativo=true]:text-white data-[ativo=true]:border-pink-600', variante: 'default' },
  cliente_leo: { label: 'Cliente Leo', cor: '#65a30d', classeAtivo: 'data-[ativo=true]:bg-lime-600 data-[ativo=true]:text-white data-[ativo=true]:border-lime-600', variante: 'default' },
}

/** Ordem de exibição nos seletores (A classificar primeiro). */
export const ORDEM_STATUS: StatusLead[] = ['pendente', 'cliente', 'concorrente', 'lead', 'cliente_bw', 'cliente_anderson', 'cliente_leo']

/** Classificações que se pode dar a um lead (tudo menos "a classificar"). */
export const STATUS_CLASSIFICAVEIS: StatusLead[] = ORDEM_STATUS.filter((s) => s !== 'pendente')
