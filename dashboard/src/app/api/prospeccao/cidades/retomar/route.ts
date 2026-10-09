import { after, NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { executarEEncadear } from '@/lib/prospeccao/executar-mapeamento'
import { usuarioPodeProspectar } from '@/lib/prospeccao/acesso'

/** Religa mapeamentos parados (a cadeia de continuação caiu: deploy no meio, timeout, etc.).
 * A tela de Rotas chama enquanto houver rota "mapeando". Só retoma quem está sem progresso há
 * mais de 90 s, então chamadas repetidas não duplicam trabalho nem custo. */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PARADO_HA_SEGUNDOS = 90

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 })
  if (!(await usuarioPodeProspectar(supabase, user.id))) {
    return NextResponse.json({ error: 'Sem acesso ao módulo de Prospecção.' }, { status: 403 })
  }

  const { data, error } = await getAdminClient().rpc('listar_mapeamentos_travados', {
    p_schema_name: TENANT_SCHEMA,
    p_segundos: PARADO_HA_SEGUNDOS,
  })
  if (error) {
    console.error('Erro ao listar mapeamentos parados:', error)
    return NextResponse.json({ error: 'Não foi possível verificar os mapeamentos.' }, { status: 500 })
  }

  const parados = (data as { id: number; token: string }[]) ?? []
  const origin = request.nextUrl.origin
  // Um por vez: cada um já ocupa a invocação inteira.
  const primeiro = parados[0]
  let retomado = false
  if (primeiro) {
    // Reivindicação atômica: se outra chamada já religou esse mapeamento, não faz de novo.
    const { data: ganhou } = await getAdminClient().rpc('reivindicar_mapeamento_cidade', {
      p_schema_name: TENANT_SCHEMA,
      p_job_id: primeiro.id,
      p_segundos: PARADO_HA_SEGUNDOS,
    })
    if (ganhou === true) {
      retomado = true
      after(() => executarEEncadear(primeiro.id, primeiro.token, origin))
    }
  }

  return NextResponse.json({ retomados: retomado ? 1 : 0, parados: parados.length })
}
