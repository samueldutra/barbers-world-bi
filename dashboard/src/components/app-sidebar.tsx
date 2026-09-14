"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { IconDashboard, IconUsers, IconReportAnalytics, IconUsersGroup } from "@tabler/icons-react"

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
import { useProfile } from "@/hooks/use-profile"
import { isAdminOrAbove } from "@/types"

const navMain = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: IconDashboard,
  },
  {
    title: "Relatório de Vendas por Produto",
    url: "/relatorio-produtos",
    icon: IconReportAnalytics,
  },
  {
    title: "Relatório de Vendas por Cliente",
    url: "/relatorio-clientes",
    icon: IconUsersGroup,
  },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { profile } = useProfile()

  const items = profile && isAdminOrAbove(profile)
    ? [...navMain, { title: "Usuários", url: "/usuarios", icon: IconUsers }]
    : navMain

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <Link href="/dashboard">
                <Image src="/logo.svg" alt="Barbers World" width={28} height={28} className="size-7 rounded" />
                <span className="text-base font-semibold">Barbers World BI</span>
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
