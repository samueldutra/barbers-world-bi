'use client'

import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { useUser } from '@/hooks/use-user'
import type { UserProfile } from '@/types'

/**
 * Perfil (role, nome, tema) do usuário logado, vindo de public.user_profiles.
 * Versão simplificada do use-tenant.ts do datapro-findash — sem troca de tenant,
 * já que o BI da Barbers World atende só um tenant por enquanto.
 */
export function useProfile() {
  const { user, loading: loadingUser } = useUser()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    if (loadingUser) return

    if (!user) {
      setProfile(null)
      setLoading(false)
      return
    }

    let isMounted = true
    supabase
      .from('user_profiles')
      .select('id, full_name, role, is_active, theme_preference')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (isMounted) {
          setProfile((data as UserProfile) ?? null)
          setLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [user, loadingUser, supabase])

  return { profile, loading: loadingUser || loading }
}
