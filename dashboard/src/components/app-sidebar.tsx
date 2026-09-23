"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { IconDashboard, IconUsers, IconReportAnalytics, IconUsersGroup, IconMapPin, IconTags } from "@tabler/icons-react"

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
import { useAuthorizedModules } from "@/hooks/use-authorized-modules"
import { isSuperAdmin } from "@/types"

const navMain = [
  {
    id: "dashboard",
    title: "Dashboard",
    url: "/dashboard",
    icon: IconDashboard,
  },
  {
    id: "relatorio-produtos",
    title: "Relatório de Vendas por Produto",
    url: "/relatorio-produtos",
    icon: IconReportAnalytics,
  },
  {
    id: "relatorio-clientes",
    title: "Relatório de Vendas por Cliente",
    url: "/relatorio-clientes",
    icon: IconUsersGroup,
  },
  {
    id: "conferencia-precos",
    title: "Conferência de Preços",
    url: "/conferencia-precos",
    icon: IconTags,
  },
  {
    id: "prospeccao",
    title: "Prospecção de Leads",
    url: "/prospeccao",
    icon: IconMapPin,
    items: [
      { title: "Mapeamento de Leads", url: "/prospeccao/mapeamento" },
      { title: "Rotas", url: "/prospeccao/rotas" },
    ],
  },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { profile } = useProfile()
  const { modules } = useAuthorizedModules()
  const superAdmin = isSuperAdmin(profile)

  const liberados = navMain.filter((item) => superAdmin || modules.includes(item.id))
  const items = superAdmin
    ? [...liberados, { id: "usuarios", title: "Usuários", url: "/usuarios", icon: IconUsers }]
    : liberados

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
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white">
                  <Image src="/logo.svg" alt="Barbers World" width={22} height={22} className="object-contain" />
                </span>
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
