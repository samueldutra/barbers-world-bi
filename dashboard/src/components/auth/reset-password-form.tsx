'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, CheckCircle2, XCircle, AlertTriangle, Loader2, ShieldCheck, Lock } from 'lucide-react'
import Link from 'next/link'

type FormStatus = 'validating' | 'ready' | 'submitting' | 'success' | 'error'

export function ResetPasswordForm() {
  // Sempre a paleta clara (color-scheme forçado por .auth-light no layout) — sem dark:
  // aqui de propósito, senão o tema escuro do sistema (Mac/iPhone) troca o texto do input
  // pra branco e ele some em cima do fundo claro.
  const contasInputClassName =
    'h-10 border-[#C7C7C7] bg-background text-[#171717] placeholder:text-[#707070] focus-visible:border-input focus-visible:ring-0'
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [status, setStatus] = useState<FormStatus>('validating')
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(3)

  const router = useRouter()
  const supabase = createClient()

  const passwordsMatch = password.trim() === confirmPassword.trim() && confirmPassword.length > 0

  // Check for active session on mount
  useEffect(() => {
    let isMounted = true

    const checkSession = async () => {
      console.log('[ResetPassword] Checking for active session...')

      await new Promise(resolve => setTimeout(resolve, 500))

      const { data: { session } } = await supabase.auth.getSession()

      if (!isMounted) return

      if (session) {
        console.log('[ResetPassword] Session found, ready for password update')
        setStatus('ready')
      } else {
        console.log('[ResetPassword] No session found')
        setError('Sessão não encontrada. Por favor, solicite um novo link de recuperação.')
        setStatus('error')
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[ResetPassword] Auth state changed:', event, !!session)

      if (!isMounted) return

      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        if (session) {
          setStatus('ready')
        }
      }
    })

    checkSession()

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [supabase.auth])

  // Countdown after success
  useEffect(() => {
    if (status === 'success' && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    } else if (status === 'success' && countdown === 0) {
      router.push('/login?message=Senha redefinida com sucesso! Faça login com sua nova senha.')
      router.refresh()
    }
  }, [status, countdown, router])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('submitting')
    setError(null)

    const trimmedPassword = password.trim()

    if (trimmedPassword.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres')
      setStatus('ready')
      return
    }

    if (trimmedPassword !== confirmPassword.trim()) {
      setError('As senhas não coincidem')
      setStatus('ready')
      return
    }

    const { data: { session: currentSession } } = await supabase.auth.getSession()

    if (!currentSession) {
      setError('Sua sessão expirou. Por favor, solicite um novo link de recuperação.')
      setStatus('error')
      return
    }

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: trimmedPassword,
      })

      if (updateError) {
        console.error('[ResetPassword] Error updating password:', updateError)

        if (updateError.message.includes('same')) {
          setError('A nova senha deve ser diferente da senha anterior')
        } else if (updateError.message.includes('session')) {
          setError('Sua sessão expirou. Por favor, solicite um novo link de recuperação.')
          setStatus('error')
          return
        } else {
          setError(updateError.message || 'Erro ao redefinir senha. Tente novamente.')
        }
        setStatus('ready')
        return
      }

      // Encerra sessão de recuperação para exigir novo login explícito
      await supabase.auth.signOut()

      setStatus('success')
    } catch (err) {
      console.error('[ResetPassword] Unexpected error:', err)
      setError('Erro ao redefinir senha. Tente novamente.')
      setStatus('ready')
    }
  }, [password, confirmPassword, supabase.auth])

  // Loading state while validating
  if (status === 'validating') {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Verificando sessão...</p>
      </div>
    )
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="flex flex-col gap-6">
        <Alert className="border-red-200 bg-red-50">
          <XCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            {error}
          </AlertDescription>
        </Alert>

        <div className="flex flex-col gap-3">
          <Link href="/recuperar-senha">
            <Button className="w-full">
              Solicitar novo link
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="outline" className="w-full">
              Voltar para o login
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  // Success state
  if (status === 'success') {
    return (
      <div className="flex flex-col gap-6 py-4">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="h-16 w-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <ShieldCheck className="h-8 w-8 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Senha redefinida com sucesso!</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Sua nova senha foi configurada.
            </p>
          </div>
        </div>

        <Alert className="border-emerald-200 bg-emerald-50">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertDescription className="text-emerald-800">
            Redirecionando para o dashboard em {countdown} segundo{countdown !== 1 ? 's' : ''}...
          </AlertDescription>
        </Alert>

        <Button
          onClick={() => { router.push('/login?message=Senha redefinida com sucesso! Faça login com sua nova senha.'); router.refresh() }}
          className="w-full"
        >
          Ir para o login
        </Button>
      </div>
    )
  }

  // Main form
  return (
    <div className="flex flex-col gap-6">
      {/* Form */}
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          {/* Password Field */}
          <Field>
            <FieldLabel htmlFor="password" className="text-[#171717] dark:text-[#171717]">Nova senha</FieldLabel>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Digite sua nova senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={status === 'submitting'}
                autoFocus
                className={`${contasInputClassName} pl-10 pr-10`}
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
            <FieldDescription>Mínimo de 6 caracteres</FieldDescription>
          </Field>

          {/* Confirm Password Field */}
          <Field>
            <FieldLabel htmlFor="confirmPassword" className="text-[#171717] dark:text-[#171717]">Confirmar nova senha</FieldLabel>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Digite novamente sua nova senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={status === 'submitting'}
                className={`${contasInputClassName} pl-10 pr-10 ${
                  confirmPassword && (passwordsMatch ? 'border-emerald-500 focus-visible:ring-emerald-500' : 'border-red-500 focus-visible:ring-red-500')
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {/* Password Match Indicator */}
            {confirmPassword && (
              <div className={`flex items-center gap-1.5 text-xs ${
                passwordsMatch ? 'text-emerald-600' : 'text-red-500'
              }`}>
                {passwordsMatch ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Senhas coincidem
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Senhas não coincidem
                  </>
                )}
              </div>
            )}
          </Field>

          {/* Error Alert */}
          {error && (
            <Alert className="border-red-200 bg-red-50">
              <XCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {/* Submit Button */}
          <Field>
            <Button
              type="submit"
              className="w-full"
              disabled={status === 'submitting' || !passwordsMatch || password.length < 6}
            >
              {status === 'submitting' ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Redefinindo...
                </span>
              ) : (
                'Redefinir senha'
              )}
            </Button>
          </Field>
        </FieldGroup>
      </form>

    </div>
  )
}
