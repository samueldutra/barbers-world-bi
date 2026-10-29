import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminClient } from '@/lib/supabase/admin'
import { autorizarCanais } from '@/lib/canais-integracao/autorizar'
import { configFaltando, configNuvemshop, urlAutorizacao } from '@/lib/canais-integracao/nuvemshop'
import {
  configFaltandoMercadoLivre,
  configMercadoLivre,
  urlAutorizacaoMercadoLivre,
} from '@/lib/canais-integracao/mercado-livre'
import { configFaltandoShopee, configShopee, urlAutorizacaoShopee } from '@/lib/canais-integracao/shopee'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

const idSchema = z.string().uuid()

/** Remove o cadastro (e o token guardado). Não desinstala o app dentro da Nuvemshop. */
export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { erro, tenant } = await autorizarCanais()
  if (erro) return erro
  const id = idSchema.safeParse((await ctx.params).id)
  if (!id.success) return NextResponse.json({ error: 'Canal inválido.' }, { status: 400 })

  const { error } = await getAdminClient().from('canais_integracoes').delete().eq('id', id.data).eq('tenant_id', tenant.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/** Gera uma nova URL de autorização (canal pendente, com erro ou pra reconectar). */
export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { erro, tenant } = await autorizarCanais()
  if (erro) return erro
  const id = idSchema.safeParse((await ctx.params).id)
  if (!id.success) return NextResponse.json({ error: 'Canal inválido.' }, { status: 400 })

  const admin = getAdminClient()
  const { data: canal } = await admin.from('canais_integracoes').select('plataforma').eq('id', id.data).eq('tenant_id', tenant.id).maybeSingle()
  if (!canal) return NextResponse.json({ error: 'Canal não encontrado.' }, { status: 404 })

  const plataforma = canal.plataforma
  const config = await configNuvemshop(tenant.id)
  const configML = await configMercadoLivre(tenant.id)
  const configSP = await configShopee(tenant.id)
  const appId = plataforma === 'shopee' ? configSP.appId : plataforma === 'mercado-livre' ? configML.appId : config.appId
  const faltando =
    plataforma === 'shopee' ? configFaltandoShopee(configSP)
    : plataforma === 'mercado-livre' ? configFaltandoMercadoLivre(configML)
    : configFaltando(config)
  if (faltando.length > 0 || !appId) {
    return NextResponse.json({ error: 'Integração não configurada no servidor.' }, { status: 409 })
  }

  const state = randomBytes(24).toString('hex')
  const { data, error } = await admin
    .from('canais_integracoes')
    .update({ oauth_state: state, status: 'pendente', ultimo_erro: null, updated_at: new Date().toISOString() })
    .eq('id', id.data)
    .eq('tenant_id', tenant.id)
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Canal não encontrado.' }, { status: 404 })
  return NextResponse.json({
    urlAutorizacao:
      plataforma === 'shopee' ? urlAutorizacaoShopee(appId, configSP.redirectUri!, state)
      : plataforma === 'mercado-livre' ? urlAutorizacaoMercadoLivre(appId, configML.redirectUri!, state)
      : urlAutorizacao(appId, state),
  })
}
