// Uso do plano gratuito: guarda o que o Groq informa nos cabeçalhos de cada resposta
// (x-ratelimit-*) e estima quanto já recarregou desde então.
//
// Os limites do Groq funcionam como um balde que vai enchendo: cada unidade usada volta
// aos poucos ao longo do período (ex.: 2.000 pedidos/dia → 1 pedido a cada 43,2 s).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.ts'

export type UsageKind = 'requests' | 'tokens' | 'audioSeconds'

export interface UsageWindow {
  limit: number
  remaining: number
}

export interface UsageSnapshot {
  at: number
  requests?: UsageWindow
  tokens?: UsageWindow
  audioSeconds?: UsageWindow
}

/** Período de cada limite no plano gratuito do Groq (medido em 2026-10-13, ver DECISOES D35). */
export const PERIOD_MS: Record<UsageKind, number> = {
  requests: 86_400_000,
  tokens: 60_000,
  audioSeconds: 3_600_000,
}

const HEADER_SUFFIX: Record<UsageKind, string> = {
  requests: 'requests',
  tokens: 'tokens',
  audioSeconds: 'audio-seconds',
}

export function snapshotFromHeaders(headers: Headers, now: number): UsageSnapshot | null {
  const snap: UsageSnapshot = { at: now }
  let found = false
  for (const kind of Object.keys(HEADER_SUFFIX) as UsageKind[]) {
    const limit = Number(headers.get(`x-ratelimit-limit-${HEADER_SUFFIX[kind]}`))
    const remaining = Number(headers.get(`x-ratelimit-remaining-${HEADER_SUFFIX[kind]}`))
    if (Number.isFinite(limit) && limit > 0 && Number.isFinite(remaining)) {
      snap[kind] = { limit, remaining: Math.max(0, remaining) }
      found = true
    }
  }
  return found ? snap : null
}

/** Estima o restante agora, somando o que recarregou desde o último retrato. */
export function estimateNow(snap: UsageSnapshot, now: number): UsageSnapshot {
  const out: UsageSnapshot = { at: now }
  const elapsed = Math.max(0, now - snap.at)
  for (const kind of Object.keys(PERIOD_MS) as UsageKind[]) {
    const w = snap[kind]
    if (!w) continue
    const refilled = (elapsed * w.limit) / PERIOD_MS[kind]
    out[kind] = { limit: w.limit, remaining: Math.min(w.limit, Math.floor(w.remaining + refilled)) }
  }
  return out
}

/** Fração restante (0–1) do limite que mais aperta. */
export function tightestRatio(snap: UsageSnapshot): number | null {
  const ratios = (Object.keys(PERIOD_MS) as UsageKind[])
    .map((k) => snap[k])
    .filter((w): w is UsageWindow => Boolean(w))
    .map((w) => w.remaining / w.limit)
  return ratios.length ? Math.min(...ratios) : null
}

// ---------- registro ----------

const file = join(config.dataDir, 'usage.json')
const snapshots = new Map<string, UsageSnapshot>(
  existsSync(file) ? Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, UsageSnapshot>) : [],
)
let saveTimer: NodeJS.Timeout | null = null

export function recordUsage(providerId: string, headers: Headers): void {
  const snap = snapshotFromHeaders(headers, Date.now())
  if (!snap) return
  snapshots.set(providerId, snap)
  saveTimer ??= setTimeout(() => {
    saveTimer = null
    writeFileSync(file, JSON.stringify(Object.fromEntries(snapshots), null, 2))
  }, 2000)
}

/** Uso estimado agora, ou null se o provedor ainda não foi chamado. */
export function currentUsage(providerId: string, now = Date.now()): UsageSnapshot | null {
  const snap = snapshots.get(providerId)
  return snap ? estimateNow(snap, now) : null
}
