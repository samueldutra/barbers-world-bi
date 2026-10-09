/**
 * Integração com a Nuvemshop (Tiendanube) — só usar em rotas de API (server).
 *
 * Fluxo OAuth 2.0 (authorization_code): o app da Barbers World é criado UMA vez no Portal de
 * Parceiros; cada loja conectada autoriza esse app e a Nuvemshop devolve um `code` na URL de
 * retorno, trocado aqui por um access_token (não expira) + o ID da loja (`user_id`).
 * Docs: https://tiendanube.github.io/api-documentation/authentication
 */

const AUTHORIZE_URL = (appId: string) => `https://www.nuvemshop.com.br/apps/${appId}/authorize`
const TOKEN_URL = 'https://www.tiendanube.com/apps/authorize/token'
const API_URL = 'https://api.nuvemshop.com.br/v1'

export interface ConfigNuvemshop {
  appId: string | undefined
  clientSecret: string | undefined
  /** URL de retorno que deve estar cadastrada igualzinha no app, no Portal de Parceiros. */
  redirectUri: string | undefined
}

export function configNuvemshop(): ConfigNuvemshop {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '')
  return {
    appId: process.env.NUVEMSHOP_APP_ID,
    clientSecret: process.env.NUVEMSHOP_CLIENT_SECRET,
    redirectUri: base ? `${base}/api/canais-venda/nuvemshop/callback` : undefined,
  }
}

/** Itens de configuração que faltam no servidor (nomes das variáveis de ambiente). */
export function configFaltando(c: ConfigNuvemshop = configNuvemshop()): string[] {
  const faltando: string[] = []
  if (!c.appId) faltando.push('NUVEMSHOP_APP_ID')
  if (!c.clientSecret) faltando.push('NUVEMSHOP_CLIENT_SECRET')
  if (!c.redirectUri) faltando.push('NEXT_PUBLIC_APP_URL')
  return faltando
}

export function urlAutorizacao(appId: string, state: string): string {
  return `${AUTHORIZE_URL(appId)}?state=${encodeURIComponent(state)}`
}

export interface TokenNuvemshop {
  accessToken: string
  storeId: string
  scope: string
}

export async function trocarCodePorToken(code: string): Promise<TokenNuvemshop> {
  const { appId, clientSecret } = configNuvemshop()
  if (!appId || !clientSecret) throw new Error('NUVEMSHOP_APP_ID/NUVEMSHOP_CLIENT_SECRET não configurados.')

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: appId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
    }),
    cache: 'no-store',
  })
  const corpo = await resp.json().catch(() => null)
  if (!resp.ok || !corpo?.access_token || corpo?.user_id == null) {
    const detalhe = corpo?.error_description || corpo?.error || `HTTP ${resp.status}`
    throw new Error(`A Nuvemshop recusou a autorização: ${detalhe}`)
  }
  return {
    accessToken: String(corpo.access_token),
    storeId: String(corpo.user_id),
    scope: String(corpo.scope ?? ''),
  }
}

/** A API exige o header `Authentication: bearer ...` (não é `Authorization`) e um User-Agent. */
export function headersApi(accessToken: string): Record<string, string> {
  return {
    Authentication: `bearer ${accessToken}`,
    'User-Agent': 'Barbers World BI (samueldutra.rp@gmail.com)',
    'Content-Type': 'application/json',
  }
}

export async function buscarLoja(
  storeId: string,
  accessToken: string
): Promise<{ nome: string | null; url: string | null }> {
  const resp = await fetch(`${API_URL}/${storeId}/store`, { headers: headersApi(accessToken), cache: 'no-store' })
  if (!resp.ok) throw new Error(`Não foi possível ler os dados da loja (HTTP ${resp.status}).`)
  const loja = await resp.json()
  // `name` é um objeto por idioma: { pt: '...', es: '...' }
  const nome = typeof loja.name === 'string' ? loja.name : loja.name?.pt ?? Object.values(loja.name ?? {})[0] ?? null
  return { nome: (nome as string | null) ?? null, url: loja.original_domain ?? loja.url_with_protocol ?? null }
}
