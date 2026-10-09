import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { autorizarCanais } from '@/lib/canais-integracao/autorizar'
import { buscarLoja, trocarCodePorToken } from '@/lib/canais-integracao/nuvemshop'

export const dynamic = 'force-dynamic'

function voltar(request: NextRequest, params: Record<string, string>) {
  const url = new URL('/canais-venda', request.nextUrl.origin)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

/**
 * URL de retorno do OAuth (cadastrada no app, no Portal de Parceiros). A Nuvemshop redireciona o
 * navegador do lojista pra cá com `?code=...&state=...`. Quem chega precisa estar logado no BI
 * com o módulo liberado; o `state` liga o retorno ao cadastro criado em POST /api/canais-venda.
 */
export async function GET(request: NextRequest) {
  const { erro } = await autorizarCanais()
  if (erro) return voltar(request, { erro: 'Sessão expirada ou sem acesso. Entre de novo e reconecte o canal.' })

  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  if (!code || !state) return voltar(request, { erro: 'A Nuvemshop não devolveu o código de autorização.' })

  const admin = getAdminClient()
  const { data: canal } = await admin
    .from('canais_integracoes')
    .select('id')
    .eq('oauth_state', state)
    .eq('plataforma', 'nuvemshop')
    .maybeSingle()
  if (!canal) return voltar(request, { erro: 'Autorização desconhecida ou já usada. Gere o link de novo.' })

  try {
    const token = await trocarCodePorToken(code)
    const loja = await buscarLoja(token.storeId, token.accessToken).catch(() => ({ nome: null, url: null }))
    const agora = new Date().toISOString()
    const { error } = await admin
      .from('canais_integracoes')
      .update({
        status: 'conectado',
        oauth_state: null, // uso único
        store_id: token.storeId,
        store_nome: loja.nome,
        store_url: loja.url,
        access_token: token.accessToken,
        scope: token.scope,
        ultimo_erro: null,
        conectado_em: agora,
        updated_at: agora,
      })
      .eq('id', canal.id)
    if (error) {
      const jaCadastrada = error.code === '23505'
      throw new Error(jaCadastrada ? 'Esta loja da Nuvemshop já está cadastrada em outro canal.' : error.message)
    }
    return voltar(request, { conectado: '1' })
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : 'Erro ao conectar.'
    await admin
      .from('canais_integracoes')
      .update({ status: 'erro', oauth_state: null, ultimo_erro: mensagem, updated_at: new Date().toISOString() })
      .eq('id', canal.id)
    return voltar(request, { erro: mensagem })
  }
}
