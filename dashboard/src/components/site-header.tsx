"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { ativo, navMain, navUsuarios } from "@/components/nav-items"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

/** Trilha da página atual: "Grupo > Página" para submenus, só o título nos demais. */
function trilha(pathname: string): string[] {
  for (const item of [...navMain, navUsuarios]) {
    const sub = item.items?.find((s) => ativo(pathname, s.url))
    if (sub) return [item.title, sub.title]
    if (ativo(pathname, item.url)) return [item.title]
  }
  return []
}

export function SiteHeader() {
  const pathname = usePathname()
  const partes = trilha(pathname)

  return (
    <header className="flex h-16 shrink-0 items-center gap-2">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
        <Breadcrumb>
          <BreadcrumbList>
            {partes.map((parte, i) => {
              const ultimo = i === partes.length - 1
              return (
                <React.Fragment key={parte}>
                  <BreadcrumbItem className={ultimo ? undefined : "hidden md:block"}>
                    {ultimo ? <BreadcrumbPage>{parte}</BreadcrumbPage> : <span>{parte}</span>}
                  </BreadcrumbItem>
                  {/* O separador é irmão do item (dentro do item ele quebra de linha). */}
                  {!ultimo && <BreadcrumbSeparator className="hidden md:block" />}
                </React.Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  )
}
