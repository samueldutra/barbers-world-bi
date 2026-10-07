"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  IconDashboard,
  IconMapPin,
  IconMenu2,
  IconReportAnalytics,
  IconTags,
  IconUsers,
  IconUsersGroup,
  type Icon,
} from "@tabler/icons-react"

import { NavUser } from "@/components/nav-user"
import { Button } from "@/components/ui/button"
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { useAuthorizedModules } from "@/hooks/use-authorized-modules"
import { useProfile } from "@/hooks/use-profile"
import { cn } from "cn"
import { isSuperAdmin } from "@/types"

interface NavItem {
  /** Id do módulo em user_modulos_acesso (controla quem enxerga o item). */
  id: string
  title: string
  url: string
  icon: Icon
  /** Submenus — o item vira um menu suspenso e fica ativo em qualquer um deles. */
  items?: { title: string; description?: string; url: string }[]
}

const navMain: NavItem[] = [
  { id: "dashboard", title: "Dashboard", url: "/dashboard", icon: IconDashboard },
  { id: "relatorio-produtos", title: "Vendas por Produto", url: "/relatorio-produtos", icon: IconReportAnalytics },
  { id: "relatorio-clientes", title: "Vendas por Cliente", url: "/relatorio-clientes", icon: IconUsersGroup },
  { id: "conferencia-precos", title: "Conferência de Preços", url: "/conferencia-precos", icon: IconTags },
  {
    id: "prospeccao",
    title: "Prospecção de Leads",
    url: "/prospeccao",
    icon: IconMapPin,
    items: [
      { title: "Mapeamento de Leads", description: "Busque e classifique estabelecimentos no mapa", url: "/prospeccao/mapeamento" },
      { title: "Rotas", description: "Monte e acompanhe rotas de visita", url: "/prospeccao/rotas" },
    ],
  },
]

function ativo(pathname: string, url: string) {
  return pathname === url || pathname.startsWith(`${url}/`)
}

export function AppNavbar() {
  const pathname = usePathname()
  const { profile } = useProfile()
  const { modules } = useAuthorizedModules()
  const superAdmin = isSuperAdmin(profile)
  const [menuMobileAberto, setMenuMobileAberto] = React.useState(false)

  const liberados = navMain.filter((item) => superAdmin || modules.includes(item.id))
  const items: NavItem[] = superAdmin
    ? [...liberados, { id: "usuarios", title: "Usuários", url: "/usuarios", icon: IconUsers }]
    : liberados

  const logo = (
    <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white">
        <Image src="/logo.svg" alt="Barbers World" width={22} height={22} className="object-contain" />
      </span>
      <span className="text-base font-semibold">Barbers World BI</span>
    </Link>
  )

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 lg:px-6">
      {/* Celular: menu em gaveta. */}
      <Sheet open={menuMobileAberto} onOpenChange={setMenuMobileAberto}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="-ml-2 md:hidden" aria-label="Abrir menu">
            <IconMenu2 className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b">
            <SheetTitle className="text-left">Barbers World BI</SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-1 p-2">
            {items.map((item) => (
              <div key={item.id} className="flex flex-col gap-1">
                {item.items ? (
                  <>
                    <span className="flex items-center gap-2 px-3 pt-2 text-xs font-medium uppercase text-muted-foreground">
                      <item.icon className="size-4" />
                      {item.title}
                    </span>
                    {item.items.map((sub) => (
                      <Link
                        key={sub.url}
                        href={sub.url}
                        onClick={() => setMenuMobileAberto(false)}
                        className={cn(
                          "rounded-md py-2 pr-3 pl-9 text-sm hover:bg-accent",
                          ativo(pathname, sub.url) && "bg-accent font-medium"
                        )}
                      >
                        {sub.title}
                      </Link>
                    ))}
                  </>
                ) : (
                  <Link
                    href={item.url}
                    onClick={() => setMenuMobileAberto(false)}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent",
                      ativo(pathname, item.url) && "bg-accent font-medium"
                    )}
                  >
                    <item.icon className="size-4" />
                    {item.title}
                  </Link>
                )}
              </div>
            ))}
          </nav>
        </SheetContent>
      </Sheet>

      {logo}

      {/* Desktop: navigation menu. */}
      <NavigationMenu viewport={false} className="mx-4 hidden md:flex">
        <NavigationMenuList>
          {items.map((item) => (
            <NavigationMenuItem key={item.id}>
              {item.items ? (
                <>
                  <NavigationMenuTrigger
                    data-active={ativo(pathname, item.url)}
                    className="gap-2 data-[active=true]:bg-accent/50"
                  >
                    <item.icon className="size-4" />
                    {item.title}
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <ul className="grid w-72 gap-1">
                      {item.items.map((sub) => (
                        <li key={sub.url}>
                          <NavigationMenuLink asChild active={ativo(pathname, sub.url)}>
                            <Link href={sub.url}>
                              <span className="font-medium">{sub.title}</span>
                              {sub.description && (
                                <span className="text-xs text-muted-foreground">{sub.description}</span>
                              )}
                            </Link>
                          </NavigationMenuLink>
                        </li>
                      ))}
                    </ul>
                  </NavigationMenuContent>
                </>
              ) : (
                <NavigationMenuLink
                  asChild
                  active={ativo(pathname, item.url)}
                  className={cn(navigationMenuTriggerStyle(), "flex-row gap-2 data-[active=true]:bg-accent/50")}
                >
                  <Link href={item.url}>
                    <item.icon className="size-4" />
                    {item.title}
                  </Link>
                </NavigationMenuLink>
              )}
            </NavigationMenuItem>
          ))}
        </NavigationMenuList>
      </NavigationMenu>

      <div className="ml-auto">
        <NavUser />
      </div>
    </header>
  )
}
