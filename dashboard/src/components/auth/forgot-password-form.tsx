'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { CheckCircle2, Loader2, Mail } from 'lucide-react'
import Link from 'next/link'

export function ForgotPasswordForm() {
  const contasInputClassName =
    'h-10 border-[#C7C7C7] bg-background text-[#171717] placeholder:text-[#707070] dark:border-input dark:bg-card dark:text-[#FFFFFF] dark:placeholder:text-[#898989] focus-visible:border-input focus-visible:ring-0'
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const supabase = createClient()

  const getResetPasswordErrorMessage = (authError: unknown): string => {
    const errorMessage =
      typeof authError === 'object' &&
      authError !== null &&
      'message' in authError &&
      typeof authError.message === 'string'
        ? authError.message.toLowerCase()
        : ''

    const status =
      typeof authError === 'object' &&
      authError !== null &&
      'status' in authError &&
      typeof authError.status === 'number'
        ? authError.status
        : null

    if (status === 429 || errorMessage.includes('rate limit')) {
      return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.'
    }

    return 'Erro ao enviar email. Verifique o endereço e tente novamente.'
  }

  const isRateLimitError = (authError: unknown): boolean => {
    const errorMessage =
      typeof authError === 'object' &&
      authError !== null &&
      'message' in authError &&
      typeof authError.message === 'string'
        ? authError.message.toLowerCase()
        : ''

    const status =
      typeof authError === 'object' &&
      authError !== null &&
      'status' in authError &&
      typeof authError.status === 'number'
        ? authError.status
        : null

    return status === 429 || errorMessage.includes('rate limit')
  }

  useEffect(() => {
    if (cooldownSeconds <= 0) return

    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [cooldownSeconds])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (cooldownSeconds > 0) {
      setError(
        `Aguarde ${cooldownSeconds}s antes de tentar novamente para enviar outro email.`
      )
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(false)

    const { error } = await supabase.auth
      .resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      })
      .catch((caughtError) => ({ data: null, error: caughtError }))

    if (error) {
      setError(getResetPasswordErrorMessage(error))
      if (isRateLimitError(error)) {
        setCooldownSeconds(60)
      }
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <div className="flex flex-col gap-4">
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Email enviado com sucesso! Verifique sua caixa de entrada e siga as
            instruções para redefinir sua senha.
          </AlertDescription>
        </Alert>
        <Link href="/login">
          <Button className="h-[42px] w-full text-[18px]">Voltar para login</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Form */}
      <form
        onSubmit={(e) => {
          void handleSubmit(e)
        }}
      >
        <FieldGroup>
          {/* Email Field */}
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
                className={`${contasInputClassName} pl-10`}
              />
            </div>
          </Field>

          {/* Error Message */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Submit Button */}
          <Field>
            <Button
              type="submit"
              className="h-[42px] w-full text-[18px]"
              disabled={loading || cooldownSeconds > 0}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enviando...
                </span>
              ) : cooldownSeconds > 0 ? (
                `Tente novamente em ${cooldownSeconds}s`
              ) : (
                'Enviar link de recuperação'
              )}
            </Button>
            <div className="mt-3 text-center">
              <Link href="/login" className="text-sm text-primary hover:underline">
                Voltar para login
              </Link>
            </div>
          </Field>
        </FieldGroup>
      </form>

    </div>
  )
}
