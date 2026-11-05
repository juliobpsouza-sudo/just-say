// Formato do GET /usage do servidor (uso do plano gratuito).

export interface UsageWindow {
  limit: number
  remaining: number
}

export interface ProviderUsage {
  id: string
  label: string
  kind: 'stt' | 'llm'
  enabled: boolean
  unlimited: boolean
  observed: boolean
  requests?: UsageWindow
  tokens?: UsageWindow
  audioSeconds?: UsageWindow
}

export interface UsageReport {
  at: number
  dictationsWithRefine: number | null
  dictationsTranscriptOnly: number | null
  providers: ProviderUsage[]
}

/** "≈ 2.900" com separador de milhar, ou "sem limite". */
export function formatCount(n: number | null): string {
  return n === null ? 'sem limite' : `≈ ${n.toLocaleString('pt-BR')}`
}

/** Linha curta para a bandeja e o Painel. */
export function usageSummary(report: UsageReport | null): string {
  if (!report) return 'uso gratuito: servidor fora do ar'
  return `${formatCount(report.dictationsWithRefine)} ditados restantes hoje`
}

// ---------- visão resumida do Painel ----------

export type UsageTone = 'ok' | 'warn' | 'bad'

export interface PartOverview {
  /** Modelo que atende agora (o 1º ligado da cascata que ainda tem limite). */
  model: string | null
  /** Pedidos do dia que restam no modelo em uso (0 a 1); null = sem limite. */
  ratio: number | null
  /** Cor da barra do modelo em uso. */
  barTone: UsageTone
  /** Folga da parte inteira, somando as reservas. */
  tone: UsageTone
  /** Quantos outros modelos ligados ficam de reserva. */
  reserves: number
}

export interface UsageOverview {
  tone: UsageTone
  stt: PartOverview
  llm: PartOverview
}

const WARN_RATIO = 0.3

const toneOf = (ratio: number): UsageTone => (ratio <= 0 ? 'bad' : ratio < WARN_RATIO ? 'warn' : 'ok')

/** "Groq · openai/gpt-oss-120b" → "gpt-oss-120b". */
export function shortModelName(label: string): string {
  return (label.split(' · ').pop() ?? label).split('/').pop() ?? label
}

/** Sem nenhuma janela zerada (pedidos do dia, áudio da hora, tokens do minuto). */
function available(p: ProviderUsage): boolean {
  if (p.unlimited) return true
  return [p.requests, p.audioSeconds, p.tokens].every((w) => !w || w.remaining > 0)
}

export function partOverview(list: readonly ProviderUsage[]): PartOverview {
  const on = list.filter((p) => p.enabled)
  if (on.length === 0) return { model: null, ratio: 0, barTone: 'bad', tone: 'bad', reserves: 0 }
  const inUse = on.find(available) ?? on[0]
  const ratio = inUse.unlimited ? null : inUse.requests && inUse.requests.limit > 0 ? inUse.requests.remaining / inUse.requests.limit : 1
  let tone: UsageTone
  if (on.some((p) => p.unlimited)) tone = 'ok'
  else {
    const limit = on.reduce((s, p) => s + (p.requests?.limit ?? 0), 0)
    const remaining = on.reduce((s, p) => s + (p.requests?.remaining ?? 0), 0)
    tone = toneOf(limit > 0 ? remaining / limit : 0)
  }
  return {
    model: shortModelName(inUse.label),
    ratio,
    barTone: ratio === null ? 'ok' : toneOf(ratio),
    tone,
    reserves: on.length - 1,
  }
}

const RANK: Record<UsageTone, number> = { ok: 0, warn: 1, bad: 2 }

export function usageOverview(report: UsageReport): UsageOverview {
  const stt = partOverview(report.providers.filter((p) => p.kind === 'stt'))
  const llm = partOverview(report.providers.filter((p) => p.kind === 'llm' && p.id !== 'none'))
  let tone: UsageTone = RANK[stt.tone] >= RANK[llm.tone] ? stt.tone : llm.tone
  if (report.dictationsWithRefine === 0) tone = 'bad'
  return { tone, stt, llm }
}
