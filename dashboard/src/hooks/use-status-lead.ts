'use client'

import { useMemo } from 'react'
import { useTenant } from '@/contexts/tenant-context'
import { STATUS_LEAD_PADRAO, STATUS_LEAD } from '@/lib/leads-status'
import type { StatusLead } from '@/hooks/use-leads-mapeados'

/** Classificações de lead do cliente ativo (public.tenants.config.status_lead), na ordem de exibição.
 * Só entram ids do catálogo (lib/leads-status.ts); lead com status fora da lista continua sendo exibido. */
export function useStatusLead() {
  const { tenant } = useTenant()
  return useMemo(() => {
    const configurados = tenant?.config?.status_lead
    const ordem = (configurados?.length ? configurados : STATUS_LEAD_PADRAO).filter(
      (s): s is StatusLead => s in STATUS_LEAD
    )
    return { ordem, classificaveis: ordem.filter((s) => s !== 'pendente') }
  }, [tenant])
}
