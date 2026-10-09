import {
  IconDashboard,
  IconBuildingStore,
  IconMapPin,
  IconReportAnalytics,
  IconTags,
  IconUsers,
  IconUsersGroup,
  type Icon,
} from "@tabler/icons-react"

export interface NavItem {
  /** Id do módulo em user_modulos_acesso (controla quem enxerga o item). */
  id: string
  title: string
  url: string
  icon: Icon
  /** Submenus — o item vira um grupo recolhível e fica ativo em qualquer um deles. */
  items?: { title: string; url: string }[]
}

export const navMain: NavItem[] = [
  { id: "dashboard", title: "Dashboard", url: "/dashboard", icon: IconDashboard },
  { id: "relatorio-produtos", title: "Produtos", url: "/relatorio-produtos", icon: IconReportAnalytics },
  { id: "relatorio-clientes", title: "Clientes", url: "/relatorio-clientes", icon: IconUsersGroup },
  { id: "conferencia-precos", title: "Conferência de Preços", url: "/conferencia-precos", icon: IconTags },
  { id: "canais-venda", title: "Canais de Venda", url: "/canais-venda", icon: IconBuildingStore },
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

/** Só superadmin enxerga (ver app-sidebar.tsx). */
export const navUsuarios: NavItem = { id: "usuarios", title: "Usuários", url: "/usuarios", icon: IconUsers }

export function ativo(pathname: string, url: string) {
  return pathname === url || pathname.startsWith(`${url}/`)
}
