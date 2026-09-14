import { LoginForm } from '@/components/auth/login-form'
import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { LoginAnimatedPanel } from '@/components/auth/login-animated-panel'
import Image from 'next/image'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Barbers World BI - Login',
}

function LoginFormWrapper() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}

export default function LoginPage() {
  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-2">
      <div className="flex flex-col gap-6 p-6 md:p-10">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm space-y-4">
            <div className="space-y-3 text-center">
              <div className="flex justify-center">
                <Image
                  src="/logo.svg"
                  alt="Barbers World"
                  className="h-36 w-36"
                  width={280}
                  height={280}
                />
              </div>
              <h1 className="w-full text-2xl font-semibold leading-tight tracking-tight text-[#171717] dark:text-[#171717]">
                Bem-vindo ao BI da Barbers World
              </h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                <span className="block">Entre na sua conta para acessar seus dashboards e</span>
                <span className="block">relatórios de vendas.</span>
              </p>
            </div>
            <LoginFormWrapper />
          </div>
        </div>
      </div>

      <div className="relative hidden lg:flex lg:items-center lg:justify-end">
        <div className="h-full w-full max-w-[820px]">
          <LoginAnimatedPanel />
        </div>
      </div>
    </div>
  )
}
