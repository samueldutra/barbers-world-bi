"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { Icon } from "@tabler/icons-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

export interface NavItem {
  title: string
  url: string
  icon?: Icon
  /** Submenus — o item pai leva ao primeiro deles e fica ativo em qualquer um. */
  items?: { title: string; url: string }[]
}

function ativo(pathname: string, url: string) {
  return pathname === url || pathname.startsWith(`${url}/`)
}

export function NavMain({ items }: { items: NavItem[] }) {
  const pathname = usePathname()

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={item.items ? ativo(pathname, item.url) : pathname === item.url}
                asChild
              >
                <Link href={item.items?.[0]?.url ?? item.url}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
              {item.items && (
                <SidebarMenuSub>
                  {item.items.map((sub) => (
                    <SidebarMenuSubItem key={sub.url}>
                      <SidebarMenuSubButton asChild isActive={ativo(pathname, sub.url)}>
                        <Link href={sub.url}>
                          <span>{sub.title}</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
