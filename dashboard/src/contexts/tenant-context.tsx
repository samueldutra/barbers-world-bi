"use client"

import * as React from "react"

import { definirTenantAtivo, type Tenant } from "@/lib/tenant"

interface TenantContextValue {
  /** Tenant ativo (null só para quem não tem nenhum tenant liberado). */
  tenant: Tenant | null
  /** Tenants a que o usuário tem acesso (mais de um = mostra o seletor). */
  tenants: Tenant[]
  /** Troca de tenant: grava o cookie no servidor e recarrega a página. */
  trocarTenant: (slug: string) => Promise<void>
}

const TenantContext = React.createContext<TenantContextValue | null>(null)

/** Entrega o tenant ativo, decidido no servidor (layout da área logada), aos componentes de cliente.
 * Também alimenta `tenantSchema()` (lib/tenant.ts) usado pelos hooks de dados. */
export function TenantProvider({
  tenant,
  tenants,
  children,
}: {
  tenant: Tenant | null
  tenants: Tenant[]
  children: React.ReactNode
}) {
  // Antes dos filhos: os efeitos dos hooks (que leem tenantSchema()) rodam depois deste render.
  definirTenantAtivo(tenant)

  const trocarTenant = React.useCallback(async (slug: string) => {
    const resp = await fetch("/api/tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    })
    if (!resp.ok) throw new Error("Não foi possível trocar de cliente.")
    // Recarga completa: nenhum dado do tenant anterior sobrevive em memória.
    window.location.assign("/dashboard")
  }, [])

  const value = React.useMemo(() => ({ tenant, tenants, trocarTenant }), [tenant, tenants, trocarTenant])
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
}

export function useTenant(): TenantContextValue {
  const ctx = React.useContext(TenantContext)
  if (!ctx) throw new Error("useTenant fora do TenantProvider")
  return ctx
}
