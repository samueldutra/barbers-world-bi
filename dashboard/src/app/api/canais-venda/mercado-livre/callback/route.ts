import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { autorizarCanais } from '@/lib/canais-integracao/autorizar'
import { buscarVendedor, trocarCodePorToken } from '@/lib/canais-integracao/mercado-livre'

export const dynamic = 'force-dynamic'

function voltar(request: NextRequest, params: Record<string, string>) {
  const url = new URL('/canais-venda', request.nextUrl.origin)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

/**
 * URL de retorno do OAuth (cadastrada igual no app, no DevCenter do Mercado Livre). O ML redireciona o navegador
 * do vendedor pra cá com `?code=...&state=...`. Quem chega precisa estar logado no BI com o módulo liberado; o
 * `state` liga o retorno ao cadastro criado em POST /api/canais-venda.
 */
export async function GET(request: NextRequest) {
  const { erro, tenant } = await autorizarCanais()
  if (erro) return voltar(request, { erro: 'Sessão expirada ou sem acesso. Entre de novo e reconecte o canal.' })

  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  if (!code || !state) {
    const motivo = request.nextUrl.searchParams.get('error_description') ?? request.nextUrl.searchParams.get('error')
    return voltar(request, { erro: motivo ? `O Mercado Livre recusou: ${motivo}` : 'O Mercado Livre não devolveu o código de autorização.' })
  }

  const admin = getAdminClient()
  const { data: canal } = await admin
    .from('canais_integracoes')
    .select('id')
    .eq('oauth_state', state)
    .eq('tenant_id', tenant.id)
    .eq('plataforma', 'mercado-livre')
    .maybeSingle()
  if (!canal) return voltar(request, { erro: 'Autorização desconhecida ou já usada. Gere o link de novo.' })

  try {
    const token = await trocarCodePorToken(code, tenant.id)
    const vendedor = await buscarVendedor(token.accessToken).catch(() => ({ nome: null, url: null }))
    const agora = new Date().toISOString()
    const { error } = await admin
      .from('canais_integracoes')
      .update({
        status: 'conectado',
        oauth_state: null, // uso único
        store_id: token.sellerId,
        store_nome: vendedor.nome,
        store_url: vendedor.url,
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
        token_expira_em: token.expiraEm,
        scope: token.scope,
        ultimo_erro: null,
        conectado_em: agora,
        updated_at: agora,
      })
      .eq('id', canal.id)
    if (error) {
      const jaCadastrada = error.code === '23505'
      throw new Error(jaCadastrada ? 'Esta conta do Mercado Livre já está cadastrada em outro canal.' : error.message)
    }
    return voltar(request, { conectado: '1', plataforma: 'mercado-livre' })
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : 'Erro ao conectar.'
    await admin
      .from('canais_integracoes')
      .update({ status: 'erro', oauth_state: null, ultimo_erro: mensagem, updated_at: new Date().toISOString() })
      .eq('id', canal.id)
    return voltar(request, { erro: mensagem })
  }
}
