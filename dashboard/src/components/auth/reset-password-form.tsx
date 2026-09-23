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
  // Convite (primeiro acesso) x redefinição — só muda o texto da tela.
  const [ehConvite, setEhConvite] = useState(false)

  const router = useRouter()
  const supabase = createClient()

  const passwordsMatch = password.trim() === confirmPassword.trim() && confirmPassword.length > 0

  // Valida o link ao abrir a página. O link pode chegar em três formatos:
  // 1) #access_token=...&refresh_token=...&type=invite|recovery — fluxo implícito, usado pelo
  //    convite de usuário e pelo "Esqueci minha senha" (ambos saem do servidor, ver
  //    lib/supabase/links-acesso.ts). O client do navegador é PKCE e REJEITA esse formato
  //    ("Not a valid PKCE flow url"), então a sessão é montada aqui com setSession.
  // 2) #error=...&error_code=otp_expired — link expirado/já usado.
  // 3) ?code=... — PKCE (links antigos); o próprio client troca o code se o link foi aberto
  //    no mesmo navegador que pediu. Em outro navegador não há como concluir.
  useEffect(() => {
    let isMounted = true

    const limparUrl = () => window.history.replaceState(null, '', window.location.pathname)

    const validarLink = async () => {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const query = new URLSearchParams(window.location.search)
      const tipo = hash.get('type') ?? query.get('type')
      if (tipo === 'invite' || tipo === 'signup') setEhConvite(true)

      const erroLink = hash.get('error_description') ?? query.get('error_description')
      if (erroLink) {
        limparUrl()
        const codigo = hash.get('error_code') ?? query.get('error_code')
        setError(
          codigo === 'otp_expired' || /expired|invalid/i.test(erroLink)
            ? 'Este link expirou ou já foi usado. Peça um novo link ao administrador (ou use "Esqueci minha senha").'
            : erroLink.replace(/\+/g, ' ')
        )
        setStatus('error')
        return
      }

      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')
      if (accessToken && refreshToken) {
        const { error: sessaoError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        limparUrl()
        if (!isMounted) return
        if (sessaoError) {
          console.error('[ResetPassword] Erro ao abrir sessão do link:', sessaoError)
          setError('Não foi possível validar este link. Peça um novo link de acesso.')
          setStatus('error')
        } else {
          setStatus('ready')
        }
        return
      }

      const temCode = query.has('code')
      const { data: { session } } = await supabase.auth.getSession()
      if (temCode) limparUrl()
      if (!isMounted) return

      if (session) {
        setStatus('ready')
      } else {
        setError(
          temCode
            ? 'Este link foi aberto em um navegador diferente do que pediu a troca de senha. Peça um novo link — ele funciona em qualquer aparelho.'
            : 'Sessão não encontrada. Por favor, solicite um novo link de recuperação.'
        )
        setStatus('error')
      }
    }

    validarLink()

    return () => {
      isMounted = false
    }
  }, [supabase.auth])

  // Countdown after success
  useEffect(() => {
    if (status === 'success' && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    } else if (status === 'success' && countdown === 0) {
      router.push(`/login?message=${ehConvite ? 'Senha criada! Faça login para acessar o sistema.' : 'Senha redefinida com sucesso! Faça login com sua nova senha.'}`)
      router.refresh()
    }
  }, [status, countdown, router, ehConvite])

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
            <h3 className="text-lg font-semibold text-foreground">{ehConvite ? 'Senha criada com sucesso!' : 'Senha redefinida com sucesso!'}</h3>
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
          onClick={() => { router.push(`/login?message=${ehConvite ? 'Senha criada! Faça login para acessar o sistema.' : 'Senha redefinida com sucesso! Faça login com sua nova senha.'}`); router.refresh() }}
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
                ehConvite ? 'Criar senha' : 'Redefinir senha'
              )}
            </Button>
          </Field>
        </FieldGroup>
      </form>

    </div>
  )
}
