import { after, NextRequest, NextResponse } from 'next/server'
import { executarEEncadear } from '@/lib/prospeccao/executar-mapeamento'
import { validarToken } from '@/lib/prospeccao/mapeamento-cidade'

/** Continuação do mapeamento (chamada de servidor pra servidor, sem sessão): confere o token do
 * mapeamento, responde 202 na hora e processa mais um trecho em segundo plano. */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  let body: { jobId?: unknown; token?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }
  const jobId = Number(body.jobId)
  const token = typeof body.token === 'string' ? body.token : ''
  if (!Number.isInteger(jobId) || !token) return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })

  if (!(await validarToken(jobId, token))) return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 })

  const origin = request.nextUrl.origin
  after(() => executarEEncadear(jobId, token, origin))
  return NextResponse.json({ ok: true }, { status: 202 })
}
