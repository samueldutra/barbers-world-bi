// Sem papéis/perfis: só um flag de super admin (acesso total) + módulos liberados por
// usuário (ver src/types/modules.ts e src/hooks/use-authorized-modules.ts).
export interface UserProfile {
  id: string
  full_name: string | null
  is_superadmin: boolean
  is_active: boolean
  theme_preference: 'light' | 'dark' | null
}

export function isSuperAdmin(profile: UserProfile | null): boolean {
  return profile?.is_superadmin === true
}
