import { AppNavbar } from "@/components/app-navbar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { TvModeProvider } from "@/contexts/tv-mode-context"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    // O TooltipProvider antes vinha de dentro do SidebarProvider; KPI cards e a tabela de
    // clientes usam Tooltip e quebram a página sem ele.
    <TooltipProvider delayDuration={0}>
      <TvModeProvider>
        <div className="flex min-h-svh flex-col">
          <AppNavbar />
          <main className="flex flex-1 flex-col">
            <div className="@container/main flex flex-1 flex-col gap-2">{children}</div>
          </main>
        </div>
      </TvModeProvider>
    </TooltipProvider>
  )
}
