// Papéis de usuário (mesmo modelo do datapro-findash).
export type UserRole = 'superadmin' | 'admin' | 'user' | 'viewer'

export interface UserProfile {
  id: string
  full_name: string | null
  role: UserRole
  is_active: boolean
  theme_preference: 'light' | 'dark' | null
}

export interface Permission {
  canManageUsers: boolean
  canViewFinancialData: boolean
  canEditFinancialData: boolean
}

export const RolePermissions: Record<UserRole, Permission> = {
  superadmin: { canManageUsers: true, canViewFinancialData: true, canEditFinancialData: true },
  admin: { canManageUsers: true, canViewFinancialData: true, canEditFinancialData: true },
  user: { canManageUsers: false, canViewFinancialData: true, canEditFinancialData: false },
  viewer: { canManageUsers: false, canViewFinancialData: true, canEditFinancialData: false },
}

export function getPermissionsForRole(role: UserRole): Permission {
  return RolePermissions[role]
}

export function isSuperAdmin(profile: UserProfile | null): boolean {
  return profile?.role === 'superadmin'
}

export function isAdminOrAbove(profile: UserProfile | null): boolean {
  return profile?.role === 'superadmin' || profile?.role === 'admin'
}

export const RoleLabels: Record<UserRole, string> = {
  superadmin: 'Super Administrador',
  admin: 'Administrador',
  user: 'Gestor',
  viewer: 'Visualizador',
}
