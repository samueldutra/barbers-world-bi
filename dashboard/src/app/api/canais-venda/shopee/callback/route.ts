import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { autorizarCanais } from '@/lib/canais-integracao/autorizar'
import { buscarLoja, trocarCodePorToken } from '@/lib/canais-integracao/shopee'

export const dynamic = 'force-dynamic'

function voltar(request: NextRequest, params: Record<string, string>) {
  const url = new URL('/canais-venda', request.nextUrl.origin)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

/**
 * URL de retorno do OAuth da Shopee (o domínio precisa estar declarado no Console do app). A Shopee redireciona o
 * navegador do lojista pra cá com `?code=...&shop_id=...` (ou `main_account_id`) e o `state` enviado no link. Quem
 * chega precisa estar logado no BI com o módulo liberado; o `state` liga o retorno ao cadastro de POST /api/canais-venda.
 */
export async function GET(request: NextRequest) {
  const { erro, tenant } = await autorizarCanais()
  if (erro) return voltar(request, { erro: 'Sessão expirada ou sem acesso. Entre de novo e reconecte o canal.' })

  const p = request.nextUrl.searchParams
  const code = p.get('code')
  const state = p.get('state')
  if (!code || !state) {
    return voltar(request, { erro: 'A Shopee não devolveu o código de autorização (ou o state). Gere o link de novo.' })
  }

  const admin = getAdminClient()
  const { data: canal } = await admin
    .from('canais_integracoes')
    .select('id')
    .eq('oauth_state', state)
    .eq('tenant_id', tenant.id)
    .eq('plataforma', 'shopee')
    .maybeSingle()
  if (!canal) return voltar(request, { erro: 'Autorização desconhecida ou já usada. Gere o link de novo.' })

  try {
    const token = await trocarCodePorToken(code, { shopId: p.get('shop_id'), mainAccountId: p.get('main_account_id') }, tenant.id)
    const loja = await buscarLoja(token, tenant.id).catch(() => ({ nome: null, autorizacaoExpiraEm: null }))
    const agora = new Date().toISOString()
    const { error } = await admin
      .from('canais_integracoes')
      .update({
        status: 'conectado',
        oauth_state: null, // uso único
        store_id: token.shopId,
        store_nome: loja.nome,
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
        token_expira_em: token.expiraEm,
        autorizacao_expira_em: loja.autorizacaoExpiraEm,
        ultimo_erro: null,
        conectado_em: agora,
        updated_at: agora,
      })
      .eq('id', canal.id)
    if (error) {
      const jaCadastrada = error.code === '23505'
      throw new Error(jaCadastrada ? 'Esta loja da Shopee já está cadastrada em outro canal.' : error.message)
    }
    return voltar(request, { conectado: '1', plataforma: 'shopee' })
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : 'Erro ao conectar.'
    await admin
      .from('canais_integracoes')
      .update({ status: 'erro', oauth_state: null, ultimo_erro: mensagem, updated_at: new Date().toISOString() })
      .eq('id', canal.id)
    return voltar(request, { erro: mensagem })
  }
}
