'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, AlertCircle, Info, Eye, EyeOff, Loader2, Mail, Lock } from 'lucide-react'

export function LoginForm() {
  // Sempre a paleta clara (color-scheme forçado por .auth-light no layout) — sem dark:
  // aqui de propósito, senão o tema escuro do sistema (Mac/iPhone) troca o texto do input
  // pra branco e ele some em cima do fundo claro.
  const inputClassName =
    'h-10 border-[#C7C7C7] bg-background text-[#171717] placeholder:text-[#707070] focus-visible:border-input focus-visible:ring-0'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [urlMessage, setUrlMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  useEffect(() => {
    const message = searchParams.get('message')
    const errorParam = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')

    if (message) {
      setUrlMessage({ type: 'info', text: processSupabaseMessage(message) })
    } else if (errorParam) {
      setUrlMessage({ type: 'error', text: processErrorMessage(errorDescription || errorParam) })
    }
  }, [searchParams])

  const processSupabaseMessage = (message: string): string => {
    if (message.includes('Sessão expirada')) {
      return 'Sua sessão expirou. Por favor, faça login novamente.'
    }
    if (message.includes('Email confirmed')) {
      return 'Email confirmado com sucesso! Você pode fazer login.'
    }
    return message.replace(/\+/g, ' ')
  }

  const processErrorMessage = (error: string): string => {
    const errorLower = error.toLowerCase()
    if (errorLower.includes('acesso negado')) {
      return 'Acesso negado. Suas credenciais podem ter sido alteradas. Tente fazer login novamente.'
    }
    if (errorLower.includes('email not confirmed')) {
      return 'Email ainda não confirmado. Verifique sua caixa de entrada.'
    }
    if (errorLower.includes('invalid link')) {
      return 'Link inválido ou expirado. Solicite um novo link.'
    }
    if (errorLower.includes('expired')) {
      return 'Link expirado. Por favor, solicite um novo link.'
    }
    return error.replace(/\+/g, ' ')
  }

  const getLoginErrorMessage = (error: { message: string; status?: number }): string => {
    const errorMessage = error.message.toLowerCase()

    if (
      errorMessage.includes('invalid login credentials') ||
      errorMessage.includes('invalid credentials') ||
      errorMessage.includes('invalid email or password')
    ) {
      return 'Login ou senha estão incorretos.'
    }
    if (errorMessage.includes('email not confirmed')) {
      return 'Email não confirmado. Verifique sua caixa de entrada.'
    }
    if (errorMessage.includes('user not found')) {
      return 'Usuário não encontrado. Verifique seu email.'
    }
    if (errorMessage.includes('user is disabled') || errorMessage.includes('account disabled')) {
      return 'Esta conta foi desabilitada. Entre em contato com o administrador.'
    }
    if (errorMessage.includes('too many requests') || errorMessage.includes('rate limit')) {
      return 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.'
    }
    if (errorMessage.includes('invalid email')) {
      return 'Email inválido. Verifique o formato do email.'
    }
    return 'Erro ao fazer login. Verifique suas credenciais e tente novamente.'
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const timeoutId = setTimeout(() => {
      setLoading(false)
      setError('Tempo de login excedido. Tente novamente.')
    }, 10000)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      })

      if (error) {
        clearTimeout(timeoutId)
        setError(getLoginErrorMessage(error))
        setLoading(false)
        return
      }

      clearTimeout(timeoutId)
      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      clearTimeout(timeoutId)
      console.error('Erro inesperado ao fazer login:', err)
      setError('Erro ao fazer login. Tente novamente.')
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {urlMessage && (
        <Alert
          variant={urlMessage.type === 'error' ? 'destructive' : 'default'}
          className={
            urlMessage.type === 'info'
              ? 'bg-blue-50 border-blue-200 text-blue-800'
              : urlMessage.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : ''
          }
        >
          {urlMessage.type === 'success' && <CheckCircle2 className="h-4 w-4" />}
          {urlMessage.type === 'error' && <AlertCircle className="h-4 w-4" />}
          {urlMessage.type === 'info' && <Info className="h-4 w-4" />}
          <AlertDescription>{urlMessage.text}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleLogin}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email" className="text-[#171717] dark:text-[#171717]">E-mail</FieldLabel>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="Digite seu email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                autoFocus
                className={`${inputClassName} pl-10`}
              />
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="password" className="text-[#171717] dark:text-[#171717]">Senha</FieldLabel>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Digite sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                className={`${inputClassName} pl-10 pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-1 flex justify-end">
              <Link href="/recuperar-senha" className="text-sm text-primary hover:underline">
                Esqueceu a senha?
              </Link>
            </div>

            <Button type="submit" className="mt-1 h-[42px] w-full text-[18px]" disabled={loading}>
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Entrando...
                </span>
              ) : (
                'Entrar'
              )}
            </Button>
          </Field>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </FieldGroup>
      </form>
    </div>
  )
}
