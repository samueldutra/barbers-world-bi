import { after, NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { executarEEncadear } from '@/lib/prospeccao/executar-mapeamento'
import { usuarioPodeProspectar } from '@/lib/prospeccao/acesso'

/** Inicia o mapeamento de TODAS as barbearias de uma cidade e já cria a rota (status
 * "mapeando"). Responde na hora; a busca no Google roda em segundo plano (after) e se
 * encadeia em /continuar até acabar. Ao terminar, a rota recebe as paradas e vira "planejada". */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 })
  if (!(await usuarioPodeProspectar(supabase, user.id))) {
    return NextResponse.json({ error: 'Sem acesso ao módulo de Prospecção.' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  const idIbge = Number(body.idIbge)
  const nomeRota = typeof body.nomeRota === 'string' ? body.nomeRota.trim() : ''
  if (!Number.isInteger(idIbge) || !nomeRota) {
    return NextResponse.json({ error: 'Informe a cidade e o nome da rota.' }, { status: 400 })
  }
  const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  const { data, error } = await supabase.rpc('iniciar_mapeamento_cidade', {
    p_schema_name: TENANT_SCHEMA,
    p_id_ibge: idIbge,
    p_rota_nome: nomeRota,
    p_rota_descricao: typeof body.descricao === 'string' ? body.descricao : null,
    p_ponto_partida_endereco: typeof body.pontoPartidaEndereco === 'string' ? body.pontoPartidaEndereco : null,
    p_ponto_lat: numero(body.pontoLat),
    p_ponto_lon: numero(body.pontoLon),
  })
  if (error) {
    console.error('Erro ao iniciar mapeamento de cidade:', error)
    const emAndamento = error.message.includes('em andamento')
    return NextResponse.json(
      { error: emAndamento ? 'Essa cidade já está sendo mapeada. Aguarde terminar.' : 'Não foi possível iniciar o mapeamento.' },
      { status: emAndamento ? 409 : 500 }
    )
  }

  const job = (data as { job_id: number; rota_id: number; token: string }[])[0]
  const origin = request.nextUrl.origin
  after(() => executarEEncadear(job.job_id, job.token, origin))

  return NextResponse.json({ jobId: job.job_id, rotaId: job.rota_id }, { status: 202 })
}
