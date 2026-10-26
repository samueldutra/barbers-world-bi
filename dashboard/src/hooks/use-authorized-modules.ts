'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/hooks/use-profile'
import { MODULE_IDS } from '@/types/modules'
import { useTenant } from '@/contexts/tenant-context'

/** Módulos que o usuário logado pode ver. Super admin tem tudo por definição — nem
 * consulta a tabela. Os demais só veem o que foi liberado em public.user_authorized_modules
 * para o tenant ativo. */
export function useAuthorizedModules() {
  const { profile, loading: loadingProfile } = useProfile()
  const { tenant } = useTenant()
  const [modules, setModules] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    if (loadingProfile) return

    if (!profile) {
      setModules([])
      setLoading(false)
      return
    }

    if (!tenant) {
      setModules([])
      setLoading(false)
      return
    }

    if (profile.is_superadmin) {
      setModules(MODULE_IDS)
      setLoading(false)
      return
    }

    let isMounted = true
    supabase
      .from('user_authorized_modules')
      .select('module')
      .eq('user_id', profile.id)
      .eq('tenant_id', tenant.id)
      .then(({ data }) => {
        if (isMounted) {
          setModules(((data as { module: string }[]) ?? []).map((r) => r.module))
          setLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [profile, loadingProfile, tenant, supabase])

  return { modules, loading: loadingProfile || loading }
}
