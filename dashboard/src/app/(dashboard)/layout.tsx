import { AppShell } from "@/components/app-shell"
import { TooltipProvider } from "@/components/ui/tooltip"
import { TenantProvider } from "@/contexts/tenant-context"
import { TvModeProvider } from "@/contexts/tv-mode-context"
import { createClient } from "@/lib/supabase/server"
import { tenantAtivoDaRequisicao } from "@/lib/tenant-server"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { ativo, tenants } = await tenantAtivoDaRequisicao(supabase)

  return (
    <TenantProvider tenant={ativo} tenants={tenants}>
      {/* O TooltipProvider é necessário pros Tooltip dos KPI cards e da tabela de clientes. */}
      <TooltipProvider delayDuration={0}>
        <TvModeProvider>
          <AppShell>{children}</AppShell>
        </TvModeProvider>
      </TooltipProvider>
    </TenantProvider>
  )
}
