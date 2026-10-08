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
import { useAuthorizedModules } from "@/hooks/use-authorized-modules"
import { useProfile } from "@/hooks/use-profile"
import { isSuperAdmin } from "@/types"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { profile } = useProfile()
  const { modules } = useAuthorizedModules()
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
                  <Image src="/logo.svg" alt="Barbers World" width={26} height={26} className="object-contain" />
                </span>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Barbers World</span>
                  <span className="truncate text-xs">Business Intelligence</span>
                </div>
              </Link>
            </SidebarMenuButton>
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
