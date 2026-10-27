"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"

import { IconCheck, IconSelector } from "@tabler/icons-react"
import { toast } from "sonner"

import { navMain, navUsuarios } from "@/components/nav-items"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useTenant } from "@/contexts/tenant-context"
import { useAuthorizedModules } from "@/hooks/use-authorized-modules"
import { useProfile } from "@/hooks/use-profile"
import { isSuperAdmin } from "@/types"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { profile } = useProfile()
  const { modules } = useAuthorizedModules()
  const { tenant, tenants, trocarTenant } = useTenant()
  const nomeCliente = tenant?.nome ?? "Business Intelligence"
  const superAdmin = isSuperAdmin(profile)

  const liberados = navMain.filter((item) => superAdmin || modules.includes(item.id))
  const items = superAdmin || tenant?.is_admin ? [...liberados, navUsuarios] : liberados
  const { isMobile } = useSidebar()
  const marca = (
    <>
      <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-full bg-white">
        <Image src={tenant?.logo_url ?? "/logo.svg"} alt={nomeCliente} width={26} height={26} className="object-contain" />
      </span>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{nomeCliente}</span>
        <span className="truncate text-xs">Business Intelligence</span>
      </div>
    </>
  )

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {tenants.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" aria-label="Trocar de cliente">
                    {marca}
                    <IconSelector className="ml-auto size-4 shrink-0" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                  side={isMobile ? "bottom" : "right"}
                  align="start"
                  sideOffset={4}
                >
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {superAdmin ? "Clientes (acesso total)" : "Clientes"}
                  </DropdownMenuLabel>
                  {tenants.map((t) => (
                    <DropdownMenuItem
                      key={t.slug}
                      className="gap-2"
                      onSelect={() => {
                        if (t.slug === tenant?.slug) return
                        trocarTenant(t.slug).catch(() => toast.error("Não foi possível trocar de cliente."))
                      }}
                    >
                      <span className="flex-1 truncate">{t.nome}</span>
                      {t.slug === tenant?.slug && <IconCheck className="size-4" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <SidebarMenuButton size="lg" asChild>
                <Link href="/dashboard">{marca}</Link>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
