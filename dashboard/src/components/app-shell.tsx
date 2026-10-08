"use client"

import * as React from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useTvMode } from "@/contexts/tv-mode-context"

/** Estrutura da área logada: sidebar + conteúdo. No modo TV a sidebar e o cabeçalho ficam
 * escondidos e a sidebar aparece, sobre o conteúdo, quando o mouse encosta na borda esquerda. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { tvMode } = useTvMode()
  const [aberta, setAberta] = React.useState(true)

  React.useEffect(() => {
    if (!tvMode) {
      setAberta(true)
      return
    }
    setAberta(false)

    const ZONA_GATILHO_PX = 24
    const aoMoverMouse = (e: MouseEvent) => {
      const alvo = e.target as Element | null
      // Mantém aberta enquanto o mouse está na sidebar ou num menu dela (dropdown do
      // usuário, renderizado num portal fora da sidebar).
      const sobreMenu =
        !!document.querySelector('[data-slot="sidebar-container"]')?.contains(alvo) ||
        !!alvo?.closest?.('[role="menu"], [data-radix-popper-content-wrapper]')
      setAberta(e.clientX <= ZONA_GATILHO_PX || sobreMenu)
    }
    const aoSairDaJanela = () => setAberta(false)
    document.addEventListener("mousemove", aoMoverMouse)
    document.documentElement.addEventListener("mouseleave", aoSairDaJanela)
    return () => {
      document.removeEventListener("mousemove", aoMoverMouse)
      document.documentElement.removeEventListener("mouseleave", aoSairDaJanela)
    }
  }, [tvMode])

  return (
    <SidebarProvider open={aberta} onOpenChange={setAberta}>
      <AppSidebar />
      <SidebarInset>
        {!tvMode && <SiteHeader />}
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
