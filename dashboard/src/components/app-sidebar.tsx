"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"

import { navMain, navUsuarios } from "@/components/nav-items"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
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
  const items = superAdmin ? [...liberados, navUsuarios] : liberados

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-full bg-white">
                  <Image src={tenant?.logo_url ?? "/logo.svg"} alt={nomeCliente} width={26} height={26} className="object-contain" />
                </span>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{nomeCliente}</span>
                  <span className="truncate text-xs">Business Intelligence</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {tenants.length > 1 && (
            <SidebarMenuItem>
              <select
                aria-label="Trocar de cliente"
                value={tenant?.slug ?? ""}
                onChange={(e) => void trocarTenant(e.target.value)}
                className="mt-1 w-full rounded-md border border-white/20 bg-transparent px-2 py-1 text-xs"
              >
                {tenants.map((t) => (
                  <option key={t.slug} value={t.slug} className="text-black">
                    {t.nome}
                  </option>
                ))}
              </select>
            </SidebarMenuItem>
          )}
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
