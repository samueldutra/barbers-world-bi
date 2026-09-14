/**
 * Rate limiter em memória (mesma implementação do datapro-findash).
 *
 * AVISO: reseta a cada restart do servidor e não compartilha estado entre
 * múltiplas instâncias. Para ambiente distribuído, trocar por Redis/Upstash.
 */

interface RateLimitRecord {
  count: number
  windowStart: number
}

const rateLimitStore = new Map<string, RateLimitRecord>()

const CLEANUP_INTERVAL = 5 * 60 * 1000
let lastCleanup = Date.now()

function cleanupOldRecords(windowMs: number) {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now

  for (const [key, record] of rateLimitStore.entries()) {
    if (now - record.windowStart > windowMs * 2) {
      rateLimitStore.delete(key)
    }
  }
}

export interface RateLimitConfig {
  limit: number
  windowMs: number
}

export interface RateLimitResult {
  success: boolean
  remaining: number
  resetIn: number
}

export function checkRateLimit(identifier: string, config: RateLimitConfig): RateLimitResult {
  const { limit, windowMs } = config
  const now = Date.now()

  cleanupOldRecords(windowMs)

  let record = rateLimitStore.get(identifier)

  if (!record || now - record.windowStart >= windowMs) {
    record = { count: 1, windowStart: now }
    rateLimitStore.set(identifier, record)
    return { success: true, remaining: limit - 1, resetIn: Math.ceil(windowMs / 1000) }
  }

  const remaining = limit - record.count - 1
  const resetIn = Math.ceil((record.windowStart + windowMs - now) / 1000)

  if (record.count >= limit) {
    return { success: false, remaining: 0, resetIn }
  }

  record.count++
  return { success: true, remaining: Math.max(0, remaining), resetIn }
}

export const rateLimiters = {
  /** 300 req/min — uso geral */
  standard: (identifier: string) => checkRateLimit(identifier, { limit: 300, windowMs: 60 * 1000 }),
  /** 30 req/min — operações sensíveis (gestão de usuários, config) */
  strict: (identifier: string) => checkRateLimit(identifier, { limit: 30, windowMs: 60 * 1000 }),
  /** 10 req/min — login, recuperação de senha (proteção contra força bruta) */
  auth: (identifier: string) => checkRateLimit(identifier, { limit: 10, windowMs: 60 * 1000 }),
  /** 150 req/min — relatórios/dashboards com múltiplas chamadas paralelas */
  reports: (identifier: string) => checkRateLimit(identifier, { limit: 150, windowMs: 60 * 1000 }),
}

export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0].trim()

  const realIp = headers.get('x-real-ip')
  if (realIp) return realIp

  const cfConnectingIp = headers.get('cf-connecting-ip')
  if (cfConnectingIp) return cfConnectingIp

  return 'unknown'
}

export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetIn),
  }
}
