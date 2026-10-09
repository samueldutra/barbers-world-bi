import { processarMapeamento } from '@/lib/prospeccao/mapeamento-cidade'

/** Tempo de trabalho por invocação — abaixo do maxDuration (60 s) das rotas, com folga pra
 * terminar a busca em andamento e disparar a próxima invocação. */
export const ORCAMENTO_POR_INVOCACAO_MS = 40_000

/** Processa o mapeamento e, se ainda sobrou fila, dispara a próxima invocação (cadeia): cada
 * invocação trabalha ~40 s e chama /continuar, que responde na hora (202) e segue em segundo plano. */
export async function executarEEncadear(jobId: number, token: string, origin: string) {
  const resultado = await processarMapeamento(jobId, ORCAMENTO_POR_INVOCACAO_MS)
  if (resultado !== 'continua') return

  try {
    await fetch(`${origin}/api/prospeccao/cidades/continuar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, token }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    // A cadeia caiu: o mapeamento fica parado e /retomar (chamado pela tela de Rotas) religa.
    console.error(`Mapeamento ${jobId}: não foi possível disparar a continuação:`, err)
  }
}
