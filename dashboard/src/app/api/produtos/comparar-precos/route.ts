import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { TENANT_SCHEMA } from '@/lib/tenant'
import { usuarioTemModulo } from '@/lib/usuarios/tem-modulo'
import { buscarGoogleShopping } from '@/lib/comparar-precos/serpapi'
import {
  compararPrecos,
  ErroComparacao,
  LIMITE_PADRAO_POR_DIA,
  type DependenciasComparacao,
} from '@/lib/comparar-precos/comparar'

/** Compara o preço de um produto com a concorrência (Google Shopping via SerpApi). Chamada ao abrir
 * o produto na listagem de Produtos. Cada busca é paga: cache de 24 h por produto, teto diário
 * (COMPARAR_PRECOS_LIMITE_DIA, padrão 100) e acesso só pra quem tem o módulo "Produtos". */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 })
  if (!(await usuarioTemModulo(supabase, user.id, 'relatorio-produtos'))) {
    return NextResponse.json({ error: 'Sem acesso ao módulo de Produtos.' }, { status: 403 })
  }

  let body: { idProduto?: unknown; consulta?: unknown; forcar?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }
  const idProduto = Number(body.idProduto)
  if (!Number.isSafeInteger(idProduto) || idProduto <= 0) {
    return NextResponse.json({ error: 'Informe o produto.' }, { status: 400 })
  }

  const chave = process.env.SERPAPI_API_KEY
  const limiteEnv = Number(process.env.COMPARAR_PRECOS_LIMITE_DIA)
  const admin = getAdminClient()

  const deps: DependenciasComparacao = {
    chaveConfigurada: !!chave,
    agora: () => Date.now(),
    buscar: (consulta) => buscarGoogleShopping(chave ?? '', consulta),
    rpc: async <T,>(nome: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error } = await admin.rpc(nome, { p_schema_name: TENANT_SCHEMA, ...args })
      if (error) throw new Error(`${nome}: ${error.message}`)
      return data as T
    },
  }

  try {
    const resultado = await compararPrecos(deps, {
      idProduto,
      consulta: typeof body.consulta === 'string' ? body.consulta : undefined,
      forcar: body.forcar === true,
      usuarioId: user.id,
      limiteDia: Number.isFinite(limiteEnv) && limiteEnv > 0 ? limiteEnv : LIMITE_PADRAO_POR_DIA,
    })
    return NextResponse.json(resultado)
  } catch (err) {
    if (err instanceof ErroComparacao) {
      return NextResponse.json({ error: err.message, codigo: err.codigo }, { status: err.status })
    }
    console.error('Erro ao comparar preços:', err)
    return NextResponse.json({ error: 'Não foi possível comparar os preços agora.' }, { status: 500 })
  }
}
