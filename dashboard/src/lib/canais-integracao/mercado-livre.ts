/**
 * Integração com o Mercado Livre — só usar em rotas de API (server).
 *
 * OAuth 2.0 (authorization_code): o app da Barbers World é criado UMA vez no DevCenter do Mercado Livre; o
 * vendedor (precisa ser o administrador da conta, não um colaborador) autoriza o app e o ML devolve um `code`,
 * trocado aqui por access_token (vale 6 h) + refresh_token (uso único: cada renovação devolve um novo) + user_id
 * (= ID do vendedor). Docs: https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
 */

import { appDoTenant } from './app-do-tenant'

const AUTHORIZE_URL = 'https://auth.mercadolivre.com.br/authorization'
const API_URL = 'https://api.mercadolibre.com'

export interface ConfigMercadoLivre {
  appId: string | undefined
  clientSecret: string | undefined
  /** URL de retorno que deve estar cadastrada igualzinha no app (sem parte variável). */
  redirectUri: string | undefined
}

/** Config do cliente: app próprio (public.canais_apps) ou, sem linha, o da Barbers World (variáveis de ambiente). */
export async function configMercadoLivre(tenantId: string): Promise<ConfigMercadoLivre> {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '')
  const app = await appDoTenant(tenantId, 'mercado-livre', {
    appId: process.env.MERCADOLIVRE_APP_ID,
    clientSecret: process.env.MERCADOLIVRE_CLIENT_SECRET,
  })
  return {
    ...app,
    redirectUri: base ? `${base}/api/canais-venda/mercado-livre/callback` : undefined,
  }
}

/** Itens de configuração que faltam no servidor (nomes das variáveis de ambiente). */
export function configFaltandoMercadoLivre(c: ConfigMercadoLivre): string[] {
  const faltando: string[] = []
  if (!c.appId) faltando.push('MERCADOLIVRE_APP_ID')
  if (!c.clientSecret) faltando.push('MERCADOLIVRE_CLIENT_SECRET')
  if (!c.redirectUri) faltando.push('NEXT_PUBLIC_APP_URL')
  return faltando
}

export function urlAutorizacaoMercadoLivre(appId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ response_type: 'code', client_id: appId, redirect_uri: redirectUri, state })
  return `${AUTHORIZE_URL}?${q.toString()}`
}

export interface TokenMercadoLivre {
  accessToken: string
  refreshToken: string
  /** Quando o access_token vence (ISO). */
  expiraEm: string
  sellerId: string
  scope: string
}

export async function trocarCodePorToken(code: string, tenantId: string): Promise<TokenMercadoLivre> {
  const { appId, clientSecret, redirectUri } = await configMercadoLivre(tenantId)
  if (!appId || !clientSecret || !redirectUri) {
    throw new Error('MERCADOLIVRE_APP_ID/MERCADOLIVRE_CLIENT_SECRET/NEXT_PUBLIC_APP_URL não configurados.')
  }

  const resp = await fetch(`${API_URL}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: appId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    cache: 'no-store',
  })
  const corpo = await resp.json().catch(() => null)
  if (!resp.ok || !corpo?.access_token || corpo?.user_id == null) {
    const detalhe = corpo?.message || corpo?.error_description || corpo?.error || `HTTP ${resp.status}`
    throw new Error(`O Mercado Livre recusou a autorização: ${detalhe}`)
  }
  return {
    accessToken: String(corpo.access_token),
    refreshToken: String(corpo.refresh_token ?? ''),
    expiraEm: new Date(Date.now() + Number(corpo.expires_in ?? 21600) * 1000).toISOString(),
    sellerId: String(corpo.user_id),
    scope: String(corpo.scope ?? ''),
  }
}

/** Dados públicos da conta do vendedor (apelido e link da loja). */
export async function buscarVendedor(accessToken: string): Promise<{ nome: string | null; url: string | null }> {
  const resp = await fetch(`${API_URL}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!resp.ok) throw new Error(`Não foi possível ler os dados do vendedor (HTTP ${resp.status}).`)
  const u = await resp.json()
  return { nome: u.nickname ?? null, url: u.permalink ?? null }
}
