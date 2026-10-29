/**
 * Integração com a Shopee (Open Platform v2) — só usar em rotas de API (server).
 *
 * Cada cliente tem o app dele (public.canais_apps: app_id = partner_id, client_secret = partner_key) ou, sem linha,
 * o app padrão do ambiente (SHOPEE_PARTNER_ID/SHOPEE_PARTNER_KEY). O lojista abre o link de autorização, entra na loja
 * e a Shopee redireciona para cá com `code` + `shop_id` (ou `main_account_id`), trocados por access_token (4 h) +
 * refresh_token (30 dias; cada renovação devolve um novo). A autorização em si vale no máx. 365 dias.
 * Assinatura: HMAC-SHA256(partner_key, partner_id + path + timestamp [+ access_token + shop_id]), hex minúsculo.
 * Docs: https://open.shopee.com/developer-guide/20
 */

import { createHmac } from 'crypto'
import { appDoTenant } from './app-do-tenant'

/** Hosts de produção do Brasil; sobrescreva por ambiente (sandbox) em SHOPEE_AUTH_HOST / SHOPEE_API_HOST. */
const AUTH_HOST = (process.env.SHOPEE_AUTH_HOST || 'https://open.shopee.com.br').replace(/\/+$/, '')
const API_HOST = (process.env.SHOPEE_API_HOST || 'https://openplatform.shopee.com.br').replace(/\/+$/, '')

export interface ConfigShopee {
  /** partner_id do app. */
  appId: string | undefined
  /** partner_key do app (produção ≠ sandbox). */
  clientSecret: string | undefined
  /** URL de retorno; o DOMÍNIO precisa estar declarado no Console do app (Live Redirect URL Domain). */
  redirectUri: string | undefined
}

export async function configShopee(tenantId: string): Promise<ConfigShopee> {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '')
  const app = await appDoTenant(tenantId, 'shopee', {
    appId: process.env.SHOPEE_PARTNER_ID,
    clientSecret: process.env.SHOPEE_PARTNER_KEY,
  })
  return { ...app, redirectUri: base ? `${base}/api/canais-venda/shopee/callback` : undefined }
}

/** Itens de configuração que faltam (app do cliente em canais_apps ou variáveis de ambiente). */
export function configFaltandoShopee(c: ConfigShopee): string[] {
  const faltando: string[] = []
  if (!c.appId) faltando.push('SHOPEE_PARTNER_ID')
  if (!c.clientSecret) faltando.push('SHOPEE_PARTNER_KEY')
  if (!c.redirectUri) faltando.push('NEXT_PUBLIC_APP_URL')
  return faltando
}

function assinar(partnerKey: string, base: string): string {
  return createHmac('sha256', partnerKey).update(base).digest('hex')
}

export function urlAutorizacaoShopee(partnerId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    partner_id: partnerId,
    auth_type: 'seller',
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  })
  return `${AUTH_HOST}/auth?${q.toString()}`
}

export interface TokenShopee {
  accessToken: string
  refreshToken: string
  /** Quando o access_token vence (ISO). */
  expiraEm: string
  shopId: string
}

async function chamarShopee<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, { ...init, cache: 'no-store' })
  const corpo = await resp.json().catch(() => null)
  if (!resp.ok || !corpo || corpo.error) {
    const detalhe = corpo?.message || corpo?.error || `HTTP ${resp.status}`
    throw new Error(`A Shopee recusou a requisição: ${detalhe}`)
  }
  return corpo as T
}

/** Troca o `code` (uso único, vale 10 min) por tokens. Com `main_account_id`, exige uma única loja autorizada. */
export async function trocarCodePorToken(
  code: string,
  ids: { shopId?: string | null; mainAccountId?: string | null },
  tenantId: string
): Promise<TokenShopee> {
  const { appId, clientSecret } = await configShopee(tenantId)
  if (!appId || !clientSecret) throw new Error('SHOPEE_PARTNER_ID/SHOPEE_PARTNER_KEY não configurados.')

  const path = '/api/v2/auth/token/get'
  const ts = Math.floor(Date.now() / 1000)
  const sign = assinar(clientSecret, `${appId}${path}${ts}`)
  const corpoReq: Record<string, unknown> = { code, partner_id: Number(appId) }
  if (ids.shopId) corpoReq.shop_id = Number(ids.shopId)
  else if (ids.mainAccountId) corpoReq.main_account_id = Number(ids.mainAccountId)
  else throw new Error('A Shopee não devolveu o shop_id da autorização.')

  const d = await chamarShopee<{
    access_token?: string
    refresh_token?: string
    expire_in?: number
    shop_id_list?: number[]
  }>(`${API_HOST}${path}?partner_id=${appId}&timestamp=${ts}&sign=${sign}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpoReq),
  })
  if (!d.access_token || !d.refresh_token) throw new Error('A Shopee não devolveu os tokens.')

  let shopId = ids.shopId ?? null
  if (!shopId) {
    const lista = d.shop_id_list ?? []
    if (lista.length !== 1) {
      throw new Error('Autorize UMA loja por canal: entre com o login da loja (ou selecione só uma loja na conta principal).')
    }
    shopId = String(lista[0])
  }
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    expiraEm: new Date(Date.now() + Number(d.expire_in ?? 14400) * 1000).toISOString(),
    shopId,
  }
}

/** Nome da loja e quando a autorização expira (ISO). */
export async function buscarLoja(
  token: TokenShopee,
  tenantId: string
): Promise<{ nome: string | null; autorizacaoExpiraEm: string | null }> {
  const { appId, clientSecret } = await configShopee(tenantId)
  if (!appId || !clientSecret) return { nome: null, autorizacaoExpiraEm: null }
  const path = '/api/v2/shop/get_shop_info'
  const ts = Math.floor(Date.now() / 1000)
  const sign = assinar(clientSecret, `${appId}${path}${ts}${token.accessToken}${token.shopId}`)
  const q = new URLSearchParams({
    partner_id: appId,
    timestamp: String(ts),
    access_token: token.accessToken,
    shop_id: token.shopId,
    sign,
  })
  const d = await chamarShopee<{ shop_name?: string; expire_time?: number }>(`${API_HOST}${path}?${q.toString()}`)
  return {
    nome: d.shop_name ?? null,
    autorizacaoExpiraEm: d.expire_time ? new Date(d.expire_time * 1000).toISOString() : null,
  }
}
