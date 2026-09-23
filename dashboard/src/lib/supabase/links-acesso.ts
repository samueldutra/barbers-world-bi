import { createClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

/**
 * Links de acesso (convite / redefinição de senha) que funcionam em QUALQUER aparelho.
 *
 * Por que isto existe: o client do navegador (@supabase/ssr) usa o fluxo PKCE, em que o link
 * do email só pode ser concluído no MESMO navegador que pediu o email (o "code_verifier" fica
 * num cookie dele). Quando o super admin disparava o email do convidado pelo próprio
 * navegador, o link nunca funcionava pra pessoa convidada; e o "Esqueci minha senha" falhava
 * sempre que o email era aberto em outro aparelho (pedir no computador, abrir no celular).
 *
 * Aqui os emails/links saem do servidor em fluxo implícito: o Supabase valida o link e
 * redireciona pra /redefinir-senha com a sessão no fragmento (#access_token=...), que a
 * página consome (ver reset-password-form.tsx). Não depende de navegador nem de aparelho.
 */

/** Client anônimo, sem sessão, em fluxo implícito — só pra disparar email de recuperação. */
export function createImplicitClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Destino dos links. Precisa estar em Authentication → URL Configuration → Redirect URLs
 * no Supabase; se não estiver, o Supabase cai na Site URL e a tela de login encaminha. */
export function urlDefinirSenha(request: NextRequest): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || request.nextUrl.origin
  return `${base}/redefinir-senha`
}

/** Mensagem amigável pros erros de envio de email do Supabase Auth. */
export function mensagemErroEmail(err: { message?: string; status?: number; code?: string } | null): string {
  const msg = (err?.message ?? '').toLowerCase()
  if (err?.status === 429 || msg.includes('rate limit') || err?.code === 'over_email_send_rate_limit') {
    return 'Limite de envio de emails do Supabase atingido — use o link de acesso para enviar por WhatsApp.'
  }
  if (msg.includes('sending') || msg.includes('smtp') || msg.includes('email')) {
    return 'O Supabase não conseguiu enviar o email — use o link de acesso para enviar por WhatsApp.'
  }
  return err?.message || 'Falha ao enviar o email.'
}
