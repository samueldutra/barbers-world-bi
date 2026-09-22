import { getAdminClient } from '@/lib/supabase/admin'

/**
 * Acesso à API do Bling (v3) pelo servidor do Next — só usar em rotas de API.
 *
 * O token OAuth é o MESMO do ETL (tabela public.bling_oauth, 1 linha por conta). O Bling
 * rotaciona o refresh_token a cada renovação, então dois processos renovando ao mesmo tempo
 * invalidam um ao outro. Proteção aqui: a regravação só acontece se o refresh_token no banco
 * ainda for o que usamos (update condicional); se outro processo (o ETL de hora em hora)
 * renovou antes, a nossa renovação falha no Bling ou não grava — em ambos os casos relemos
 * a linha e usamos o token que o outro gravou.
 */

const BLING_API_URL = 'https://api.bling.com.br/Api/v3'
const BLING_TOKEN_URL = 'https://bling.com.br/Api/v3/oauth/token'
const MARGEM_EXPIRACAO_MS = 5 * 60 * 1000

interface LinhaOAuth {
  access_token: string
  refresh_token: string
  expires_at: string
}

function contaBling(): string {
  return process.env.BLING_CONTA || 'barbers'
}

async function lerTokens(): Promise<LinhaOAuth> {
  const { data, error } = await getAdminClient()
    .from('bling_oauth')
    .select('access_token, refresh_token, expires_at')
    .eq('conta', contaBling())
    .single()
  if (error || !data) {
    throw new Error(`Token do Bling não encontrado para a conta '${contaBling()}' (public.bling_oauth).`)
  }
  return data as LinhaOAuth
}

function tokenValido(linha: LinhaOAuth): boolean {
  return new Date(linha.expires_at).getTime() - Date.now() > MARGEM_EXPIRACAO_MS
}

async function renovarToken(atual: LinhaOAuth): Promise<string> {
  const clientId = process.env.BLING_CLIENT_ID
  const clientSecret = process.env.BLING_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('BLING_CLIENT_ID/BLING_CLIENT_SECRET não configurados no servidor.')
  }

  const resp = await fetch(BLING_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: atual.refresh_token }),
    cache: 'no-store',
  })

  if (!resp.ok) {
    // Provável corrida com o ETL: ele renovou antes e o nosso refresh_token já não vale.
    const relida = await lerTokens()
    if (relida.refresh_token !== atual.refresh_token && tokenValido(relida)) return relida.access_token
    throw new Error(`Falha ao renovar o token do Bling (${resp.status}).`)
  }

  const tokens = (await resp.json()) as { access_token: string; refresh_token: string; expires_in: number }
  const { data: gravadas, error } = await getAdminClient()
    .from('bling_oauth')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('conta', contaBling())
    .eq('refresh_token', atual.refresh_token)
    .select('conta')

  if (error) {
    // O Bling já invalidou o refresh_token antigo — se não gravarmos o novo, a cadeia quebra
    // e o ETL para de autenticar. Loga o suficiente pra investigar, sem expor o token.
    console.error('[bling] Token renovado mas não foi possível gravar em bling_oauth:', error)
    throw new Error('Token do Bling renovado mas não gravado — verifique public.bling_oauth.')
  }
  if (!gravadas || gravadas.length === 0) {
    // Outro processo gravou entre a leitura e agora; o token dele é tão válido quanto o nosso.
    return (await lerTokens()).access_token
  }
  return tokens.access_token
}

async function obterAccessToken(forcarRenovacao = false): Promise<string> {
  const linha = await lerTokens()
  if (!forcarRenovacao && tokenValido(linha)) return linha.access_token
  return renovarToken(linha)
}

export class ErroBling extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

function mensagemErroBling(corpo: unknown, status: number): string {
  const erro = (corpo as { error?: { message?: string; description?: string; fields?: { msg?: string }[] } })?.error
  const campos = erro?.fields?.map((f) => f.msg).filter(Boolean).join('; ')
  return campos || erro?.description || erro?.message || `Erro ${status} no Bling.`
}

/** Chamada autenticada; renova o token uma vez em caso de 401 e espera/retenta em 429. */
async function blingFetch(path: string, init: RequestInit): Promise<Response> {
  let token = await obterAccessToken()
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const resp = await fetch(`${BLING_API_URL}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    if (resp.status === 401 && tentativa === 0) {
      token = await obterAccessToken(true)
      continue
    }
    if (resp.status === 429) {
      // Limite de 3 req/s compartilhado com o ETL — espera e tenta de novo.
      await new Promise((r) => setTimeout(r, 1000 * (tentativa + 1)))
      continue
    }
    return resp
  }
  throw new ErroBling('Bling recusou por limite de requisições; tente novamente em instantes.', 429)
}

/** Altera só o preço de venda do produto (PATCH parcial — os demais campos ficam intactos). */
export async function alterarPrecoProduto(idProduto: number, preco: number): Promise<void> {
  const resp = await blingFetch(`/produtos/${idProduto}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preco }),
  })
  if (!resp.ok) {
    const corpo = await resp.json().catch(() => null)
    throw new ErroBling(mensagemErroBling(corpo, resp.status), resp.status)
  }
}
