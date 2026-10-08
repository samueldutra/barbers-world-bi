import { AppShell } from "@/components/app-shell"
import { TooltipProvider } from "@/components/ui/tooltip"
import { TvModeProvider } from "@/contexts/tv-mode-context"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    // O TooltipProvider é necessário pros Tooltip dos KPI cards e da tabela de clientes.
    <TooltipProvider delayDuration={0}>
      <TvModeProvider>
        <AppShell>{children}</AppShell>
      </TvModeProvider>
    </TooltipProvider>
  )
}
