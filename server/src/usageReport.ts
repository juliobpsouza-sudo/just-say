// Relatório de uso gratuito (GET /usage) e avisos de limite para a barra.
import type { Attempt } from './providers/cascade.ts'
import { GroqLlm, GroqStt } from './providers/groq.ts'
import { getProviderSettings, llmProviderList, providerLabel, sttProviderList } from './providers/registry.ts'
import type { ProviderInfo } from './providers/types.ts'
import { currentUsage, type UsageKind, type UsageSnapshot, type UsageWindow } from './usage.ts'

/** Limites do plano gratuito medidos em 2026-10-13 (D35). Usados até o 1º uso real. */
const DEFAULT_LIMITS = {
  stt: { requests: 2000, audioSeconds: 7200 },
  llm: { requests: 1000, tokens: 8000 },
} as const

export interface ProviderUsageView {
  id: string
  label: string
  kind: 'stt' | 'llm'
  enabled: boolean
  /** Não tem limite (Whisper local) ou não chama modelo (sem refino). */
  unlimited: boolean
  /** true = números vindos do Groq; false = limite padrão, ainda não usado. */
  observed: boolean
  requests?: UsageWindow
  tokens?: UsageWindow
  audioSeconds?: UsageWindow
}

export interface UsageReport {
  at: number
  /** Ditados com refino que ainda cabem agora (o menor entre STT e refino). null = sem limite. */
  dictationsWithRefine: number | null
  /** Ditados que ainda cabem só com transcrição (quando "sem refino" está ligado). null = sem limite. */
  dictationsTranscriptOnly: number | null
  providers: ProviderUsageView[]
}

function usageView(p: ProviderInfo, kind: 'stt' | 'llm', enabled: boolean, now: number): ProviderUsageView {
  const metered = p instanceof GroqStt || p instanceof GroqLlm
  const base: ProviderUsageView = { id: p.id, label: p.label, kind, enabled, unlimited: !metered, observed: false }
  if (!metered) return base
  const snap = currentUsage(p.id, now)
  if (snap) return { ...base, observed: true, ...pick(snap) }
  const defaults = DEFAULT_LIMITS[kind] as Partial<Record<UsageKind, number>>
  const full = Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, { limit: v, remaining: v }]))
  return { ...base, ...full }
}

function pick(snap: UsageSnapshot): Partial<Record<UsageKind, UsageWindow>> {
  const out: Partial<Record<UsageKind, UsageWindow>> = {}
  if (snap.requests) out.requests = snap.requests
  if (snap.tokens) out.tokens = snap.tokens
  if (snap.audioSeconds) out.audioSeconds = snap.audioSeconds
  return out
}

/** Soma os pedidos restantes dos provedores ligados; Infinity se algum não tem limite. */
export function capacity(views: ProviderUsageView[]): number {
  let total = 0
  for (const v of views) {
    if (!v.enabled) continue
    if (v.unlimited) return Number.POSITIVE_INFINITY
    total += v.requests?.remaining ?? 0
  }
  return total
}

export function usageReport(now = Date.now()): UsageReport {
  const settings = getProviderSettings()
  const enabled = (list: { id: string; enabled: boolean }[], id: string) => list.find((s) => s.id === id)?.enabled ?? false
  const stt = sttProviderList().map((p) => usageView(p, 'stt', enabled(settings.stt, p.id), now))
  const llm = llmProviderList().map((p) => usageView(p, 'llm', enabled(settings.llm, p.id), now))

  const sttCap = capacity(stt)
  const refineCap = capacity(llm.filter((v) => v.id !== 'none'))
  const passthroughOn = llm.some((v) => v.id === 'none' && v.enabled)
  const finite = (n: number) => (Number.isFinite(n) ? n : null)
  return {
    at: now,
    dictationsWithRefine: finite(Math.min(sttCap, refineCap)),
    dictationsTranscriptOnly: passthroughOn ? finite(sttCap) : 0,
    providers: [...stt, ...llm],
  }
}

// ---------- avisos ----------

const LOW_RATIO = 0.1
const LOW_NOTICE_EVERY_MS = 3_600_000
const lastLowNotice = new Map<string, number>()

/**
 * O 429 que volta em até 2 min é o limite por minuto (tokens), que estoura com 2 ou 3 ditados
 * seguidos; não é o limite gratuito do dia acabando (D92).
 */
export function limitPhrase(retryAfterMs: number | undefined): string {
  if (retryAfterMs === undefined) return 'chegou ao limite gratuito'
  if (retryAfterMs <= 120_000) return `bateu o limite por minuto (volta em ${Math.max(1, Math.ceil(retryAfterMs / 1000))} s)`
  const when = retryAfterMs < 3_600_000 ? `${Math.ceil(retryAfterMs / 60_000)} min` : `${Math.round(retryAfterMs / 3_600_000)} h`
  return `chegou ao limite gratuito (volta em ${when})`
}

/**
 * Frases curtas para a barra:
 * - um provedor bateu no limite neste pedido e a cascata passou para o próximo;
 * - o provedor usado ficou abaixo de 10% dos pedidos do dia (no máximo 1 aviso por hora).
 */
export function buildNotices(attempts: Attempt[], usedIds: string[], now = Date.now()): string[] {
  const notices: string[] = []
  for (const a of attempts) {
    if (a.failure !== 'limit') continue
    const next = attempts.find((b) => b.ok && attempts.indexOf(b) > attempts.indexOf(a))
    const what = limitPhrase(a.retryAfterMs)
    notices.push(next ? `${providerLabel(a.provider)} ${what}. Usando ${providerLabel(next.provider)}.` : `${providerLabel(a.provider)} ${what}.`)
  }
  for (const id of usedIds) {
    const req = currentUsage(id, now)?.requests
    if (!req || req.remaining / req.limit >= LOW_RATIO) continue
    if (now - (lastLowNotice.get(id) ?? 0) < LOW_NOTICE_EVERY_MS) continue
    lastLowNotice.set(id, now)
    notices.push(`${providerLabel(id)}: restam ${req.remaining} de ${req.limit} pedidos gratuitos.`)
  }
  return notices
}
