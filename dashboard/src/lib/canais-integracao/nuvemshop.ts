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

/** Altera SÓ o SKU de uma variante (PUT parcial: os demais campos — preço, estoque... — ficam como estão).
 * Exige o escopo write_products. Lança Error com a mensagem da Nuvemshop quando ela recusa. */
export async function alterarSkuVariante(
  accessToken: string,
  storeId: string,
  idProduto: number,
  idVariante: number,
  sku: string
): Promise<void> {
  const url = `${API_URL}/${storeId}/products/${idProduto}/variants/${idVariante}`
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: headersApi(accessToken),
      body: JSON.stringify({ sku }),
      cache: 'no-store',
    })
    if (resp.status === 429) {
      // Balde de requisições cheio: espera o tempo que a API informa e tenta de novo.
      const espera = Math.min(Number(resp.headers.get('x-rate-limit-reset') ?? 2000) / 1000 + 0.5, 10)
      await new Promise((r) => setTimeout(r, espera * 1000))
      continue
    }
    if (resp.ok) return
    const corpo = await resp.json().catch(() => null)
    const detalhe = corpo?.description || corpo?.message || corpo?.error || `HTTP ${resp.status}`
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(`A Nuvemshop recusou o acesso (${detalhe}). Reconecte o canal em Canais de Venda com a permissão de escrita em produtos.`)
    }
    if (resp.status === 404) throw new Error('A variante não existe mais na Nuvemshop (produto excluído?). Atualize os dados.')
    throw new Error(`A Nuvemshop recusou a alteração: ${typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe)}`)
  }
  throw new Error('A Nuvemshop está limitando as requisições; tente de novo em instantes.')
}
