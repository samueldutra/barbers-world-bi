# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Responder sempre em português do Brasil.

## Origem

Este projeto reaproveita a infraestrutura de autenticação (login, cadastro, recuperação/
redefinição de senha, logout, proteção de rotas, tema, rate limit) do **datapro-findash**
(`~/datapro-findash`), adaptada para o BI da Barbers World. Portado deliberadamente **sem**
a parte multi-tenant/multi-módulo daquele projeto (troca de tenant, `SYSTEM_MODULES`,
feature flags, gestão de "Contas") porque a Barbers World é um tenant só por enquanto —
adicionar de volta se um dia precisar atender mais de um cliente nesse mesmo frontend.

## Comandos

```bash
npm install
cp .env.local.example .env.local   # preencher NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

Não há test runner configurado ainda.

## Arquitetura

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 + shadcn/ui (style "new-york").
Mesmo projeto Supabase do ETL (`ajxmbhfmitehmxvjkcdk`), mas usando `anon key` (RLS) no
cliente/server components e `service_role` só em rotas de API que precisem bypassar RLS.

### Autenticação

- `src/proxy.ts` — entrypoint do middleware (Next 16 renomeou `middleware.ts` -> `proxy.ts`).
  Aplica CSRF check (Origin x Host em métodos mutantes), rate limit (`src/lib/security/rate-limit.ts`)
  e delega sessão pra `updateSession`.
- `src/lib/supabase/middleware.ts` (`updateSession`) — refresca a sessão, redireciona
  não-autenticado pra `/login`, autenticado tentando `/login` etc. pra `/dashboard`, e
  bloqueia `/usuarios` pra quem não é admin/superadmin.
- `src/lib/supabase/{client,server,admin}.ts` — três instâncias (browser, server
  component/route com RLS, admin com service_role) — mesmo padrão do datapro-findash.
- Páginas em `src/app/(auth)/`: `login`, `cadastro`, `recuperar-senha`, `redefinir-senha`.
  Layout do grupo (`layout.tsx`) força tema claro (`auth-light`) independente da
  preferência do usuário.
- `src/app/api/auth/{callback,recovery}/route.ts` — trocam code/token OTP do Supabase por
  sessão (confirmação de email, magic link, recovery).
- Logout: `src/components/dashboard/user-menu.tsx` (`supabase.auth.signOut()` com diálogo
  de confirmação).

### Perfil / papéis

- `public.user_profiles` (SQL: `sql/create_table_user_profiles.sql`) — 1 linha por usuário
  do Supabase Auth, criada automaticamente por trigger (`handle_new_user`) no signup.
  Papéis: `superadmin` / `admin` / `user` / `viewer` (`src/types/index.ts`,
  `RolePermissions`/`RoleLabels`).
- **O primeiro usuário precisa ser promovido a `superadmin` manualmente**:
  `UPDATE public.user_profiles SET role = 'superadmin' WHERE id = '<uuid do usuário>';`
- `src/hooks/use-profile.ts` — versão simplificada do `use-tenant.ts` do datapro-findash,
  sem troca de tenant (só busca o próprio perfil).

### Tema

`src/contexts/theme-context.tsx` — claro/escuro/sistema, persistido em
`user_profiles.theme_preference` (usuário logado) ou `localStorage` (deslogado).

## Pendências conhecidas

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` precisa ser preenchida em `.env.local` (Settings → API →
  Project API keys → anon/public) — sem isso o app não sobe.
- Rodar `sql/create_table_user_profiles.sql` no SQL Editor do Supabase antes do primeiro
  login/cadastro.
- Sem tipos gerados do banco (`database.types.ts`) — os clientes Supabase não são
  tipados por schema ainda. Gerar com `supabase gen types typescript` quando o MCP do
  Supabase estiver autorizado.
- `src/app/(dashboard)/dashboard/page.tsx` é só um placeholder — os dashboards de vendas
  por canal (pedidos_vendas / canais_venda / contatos, já carregados no schema `barbers`)
  ainda não foram construídos.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
