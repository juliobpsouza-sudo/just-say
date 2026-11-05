// Estatísticas de uso (extensão do Just Say): palavras ditadas, tempo economizado,
// sequência de dias, horários e apps. Cada ditado concluído vira um "evento" só com
// números e o nome do app, sem texto, numa tabela própria (`stats_events`) que não é
// apagada junto com o histórico. Funções puras, testadas em tests/stats.test.ts.
import type { HistoryRow } from './history'
import type { VoiceFlowMode } from './voiceFlow'

export interface StatsEvent {
  /** Mesmo id do histórico: refazer um ditado atualiza o evento, não soma outro. */
  id: string
  created_at: string
  /** Dia e hora no fuso do PC, para a sequência e o gráfico de horários. */
  local_day: string
  local_hour: number
  mode: VoiceFlowMode
  app: string | null
  words: number
  audio_seconds: number
  delivery: string | null
  web_search: number
}

/** Velocidade de digitação padrão (palavras por minuto) de quem digita no teclado. */
export const DEFAULT_TYPING_WPM = 40
export const MIN_TYPING_WPM = 10
export const MAX_TYPING_WPM = 200

/** Palavras de um texto: pedaços entre espaços que têm ao menos uma letra ou número. */
export function countWords(text: string | null | undefined): number {
  if (!text) return 0
  let n = 0
  for (const piece of text.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(piece)) n++
  return n
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Dia local `AAAA-MM-DD`. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Dia local de `day` deslocado em `delta` dias. */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return localDay(new Date(y, m - 1, d + delta))
}

/** Nome do app para mostrar: sem ".exe". */
export function appLabel(app: string | null): string {
  if (!app) return 'Sem app'
  return app.replace(/\.exe$/i, '')
}

const parse = <T,>(s: string | null): T | null => {
  if (!s) return null
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

/**
 * Linha do histórico → evento. Só ditados concluídos contam.
 * - Ditado e tradução: as palavras do texto que foi entregue.
 * - Ask Anything: as palavras do pedido falado (a resposta foi a IA que escreveu).
 */
export function statsEventFrom(row: HistoryRow): StatsEvent | null {
  if (row.status !== 'completed') return null
  const created = new Date(row.created_at)
  if (Number.isNaN(created.getTime())) return null
  const meta = parse<{ ai_result?: { user_prompt?: string | null; delivery?: string; web_metadata?: { sources?: unknown[] } | null } }>(
    row.mode_meta,
  )
  const ai = meta?.ai_result
  const sources = ai?.web_metadata?.sources
  const words =
    row.mode === 'voice_command' ? countWords(row.raw_text ?? ai?.user_prompt ?? null) : countWords(row.refined_text)
  // Toque sem fala (texto vazio) não é ditado.
  if (words === 0) return null
  return {
    id: row.id,
    created_at: row.created_at,
    local_day: localDay(created),
    local_hour: created.getHours(),
    mode: row.mode,
    app: row.focused_app,
    words,
    audio_seconds: typeof row.duration === 'number' && row.duration > 0 ? row.duration : 0,
    delivery: row.mode === 'voice_command' ? (ai?.delivery ?? null) : 'replace',
    web_search: Array.isArray(sources) && sources.length > 0 ? 1 : 0,
  }
}

/** Segundos que levaria digitando, menos o que levou falando (nunca negativo). */
export function savedSeconds(words: number, audioSeconds: number, typingWpm: number): number {
  const typing = (words / Math.max(typingWpm, 1)) * 60
  return Math.max(0, typing - audioSeconds)
}

/** Metas de palavras, para a barra de "próxima conquista". */
export const WORD_MILESTONES = [100, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000]

export interface StatsSummary {
  totals: {
    words: number
    dictations: number
    audioSeconds: number
    savedSeconds: number
    /** Livro comum: ~250 palavras por página. */
    pages: number
  }
  today: { words: number; dictations: number; savedSeconds: number }
  week: { words: number; dictations: number; savedSeconds: number }
  /** Palavras por minuto falando (só ditado e tradução, que têm o texto entregue). */
  speakingWpm: number | null
  typingWpm: number
  streak: { current: number; best: number; activeToday: boolean }
  /** Últimos `days` dias, do mais antigo para hoje. */
  daily: { day: string; words: number; dictations: number }[]
  /** Palavras por hora do dia (0 a 23). */
  hours: number[]
  modes: { transcript: number; ask: number; translation: number; webSearches: number }
  topApps: { app: string; words: number; dictations: number }[]
  longest: { words: number; day: string | null }
  bestDay: { words: number; day: string | null }
  firstDay: string | null
  milestone: { reached: number | null; next: number | null }
}

const PAGE_WORDS = 250

export function summarizeStats(
  events: readonly StatsEvent[],
  opts: { now: Date; typingWpm: number; days?: number; topApps?: number },
): StatsSummary {
  const typingWpm = Math.min(Math.max(Math.round(opts.typingWpm) || DEFAULT_TYPING_WPM, MIN_TYPING_WPM), MAX_TYPING_WPM)
  const today = localDay(opts.now)
  const weekStart = shiftDay(today, -6)
  const days = opts.days ?? 30
  const firstSeries = shiftDay(today, -(days - 1))

  const totals = { words: 0, dictations: 0, audioSeconds: 0, savedSeconds: 0, pages: 0 }
  const todayT = { words: 0, dictations: 0, savedSeconds: 0 }
  const weekT = { words: 0, dictations: 0, savedSeconds: 0 }
  const modes = { transcript: 0, ask: 0, translation: 0, webSearches: 0 }
  const hours = new Array<number>(24).fill(0)
  const byDay = new Map<string, { words: number; dictations: number }>()
  const byApp = new Map<string, { words: number; dictations: number }>()
  let speakWords = 0
  let speakSeconds = 0
  let longest = { words: 0, day: null as string | null }
  let firstDay: string | null = null

  for (const e of events) {
    const saved = savedSeconds(e.words, e.audio_seconds, typingWpm)
    totals.words += e.words
    totals.dictations++
    totals.audioSeconds += e.audio_seconds
    totals.savedSeconds += saved
    if (e.local_day === today) {
      todayT.words += e.words
      todayT.dictations++
      todayT.savedSeconds += saved
    }
    if (e.local_day >= weekStart && e.local_day <= today) {
      weekT.words += e.words
      weekT.dictations++
      weekT.savedSeconds += saved
    }
    if (e.mode === 'voice_command') modes.ask++
    else if (e.mode === 'voice_translation') modes.translation++
    else modes.transcript++
    if (e.web_search) modes.webSearches++
    if (e.mode !== 'voice_command' && e.audio_seconds > 0) {
      speakWords += e.words
      speakSeconds += e.audio_seconds
    }
    if (e.local_hour >= 0 && e.local_hour < 24) hours[e.local_hour] += e.words
    const d = byDay.get(e.local_day) ?? { words: 0, dictations: 0 }
    d.words += e.words
    d.dictations++
    byDay.set(e.local_day, d)
    const appName = appLabel(e.app)
    const a = byApp.get(appName) ?? { words: 0, dictations: 0 }
    a.words += e.words
    a.dictations++
    byApp.set(appName, a)
    if (e.words > longest.words) longest = { words: e.words, day: e.local_day }
    if (firstDay === null || e.local_day < firstDay) firstDay = e.local_day
  }
  totals.pages = Math.round((totals.words / PAGE_WORDS) * 10) / 10

  const daily: StatsSummary['daily'] = []
  for (let day = firstSeries; day <= today; day = shiftDay(day, 1)) {
    const d = byDay.get(day)
    daily.push({ day, words: d?.words ?? 0, dictations: d?.dictations ?? 0 })
  }

  let bestDay = { words: 0, day: null as string | null }
  for (const [day, d] of byDay) if (d.words > bestDay.words) bestDay = { words: d.words, day }

  const topApps = [...byApp.entries()]
    .map(([app, v]) => ({ app, ...v }))
    .sort((a, b) => b.words - a.words || b.dictations - a.dictations)
    .slice(0, opts.topApps ?? 5)

  const reached = [...WORD_MILESTONES].reverse().find((m) => totals.words >= m) ?? null
  const next = WORD_MILESTONES.find((m) => totals.words < m) ?? null

  return {
    totals,
    today: todayT,
    week: weekT,
    speakingWpm: speakSeconds >= 5 ? Math.round(speakWords / (speakSeconds / 60)) : null,
    typingWpm,
    streak: streaks(new Set(byDay.keys()), today),
    daily,
    hours,
    modes,
    topApps,
    longest,
    bestDay,
    firstDay,
    milestone: { reached, next },
  }
}

/**
 * Sequência de dias seguidos com ao menos um ditado. A atual conta até hoje, ou até ontem
 * se hoje ainda não teve ditado (a sequência não quebra antes de o dia acabar).
 */
export function streaks(activeDays: ReadonlySet<string>, today: string): StatsSummary['streak'] {
  const activeToday = activeDays.has(today)
  let current = 0
  for (let day = activeToday ? today : shiftDay(today, -1); activeDays.has(day); day = shiftDay(day, -1)) current++
  let best = 0
  for (const day of activeDays) {
    if (activeDays.has(shiftDay(day, -1))) continue // não é começo de sequência
    let len = 0
    for (let d = day; activeDays.has(d); d = shiftDay(d, 1)) len++
    best = Math.max(best, len)
  }
  return { current, best: Math.max(best, current), activeToday }
}

/** "2 h 15 min", "12 min", "40 s". */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return `${s} s`
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}
