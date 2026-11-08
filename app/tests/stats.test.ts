import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { HistoryDb, MIGRATIONS } from '../src/main/history/historyDb'
import { historyRowFrom, type HistoryRow } from '../src/shared/history'
import {
  countWords,
  formatDuration,
  localDay,
  savedSeconds,
  shiftDay,
  statsEventFrom,
  streaks,
  summarizeStats,
  type StatsEvent,
} from '../src/shared/stats'
import type { VoiceFlowRequest, VoiceFlowResult } from '../src/shared/voiceFlow'

const req = (id: string, over: Partial<VoiceFlowRequest> = {}): VoiceFlowRequest => ({
  requestId: id,
  audioId: id,
  mode: 'voice_transcript',
  audioContext: { active_application: { name: 'WhatsApp.exe' } },
  audioMetadata: { duration_ms: 6000 },
  userOverTime: 0,
  sendTime: 0,
  isRetry: false,
  parameters: {},
  timeoutMs: 20000,
  ...over,
})

const ok = (text: string, raw = text, extra: Record<string, unknown> = {}): VoiceFlowResult => ({
  ok: true,
  ms: 900,
  data: {
    refine_text: text,
    delivery: 'replace',
    user_prompt: null,
    web_metadata: null,
    external_action: null,
    debug: { transcript: raw, language: 'pt', stt: { provider: 'a', ms: 1 }, refine: { provider: 'b', ms: 1 }, total_ms: 2 },
    ...extra,
  },
})

const fail: VoiceFlowResult = { ok: false, ms: 50, error: { code: 'stt_unavailable', message: 'sem STT' } }

const row = (r: VoiceFlowRequest, result: VoiceFlowResult, now: string): HistoryRow =>
  historyRowFrom(r, result, { now, appVersion: '0.1.0', audioPath: null })

const ev = (day: string, words: number, over: Partial<StatsEvent> = {}): StatsEvent => ({
  id: `${day}-${words}-${Math.random()}`,
  created_at: `${day}T12:00:00.000Z`,
  local_day: day,
  local_hour: 10,
  mode: 'voice_transcript',
  app: 'Code.exe',
  words,
  audio_seconds: 10,
  delivery: 'replace',
  web_search: 0,
  ...over,
})

describe('contagem de palavras', () => {
  it('conta só pedaços com letra ou número', () => {
    expect(countWords('Olá, tudo bem? — sim!')).toBe(4)
    expect(countWords('  reunião  às 16h  ')).toBe(3)
    expect(countWords('- * …')).toBe(0)
    expect(countWords(null)).toBe(0)
  })
})

describe('evento a partir do histórico', () => {
  it('ditado conta as palavras do texto entregue e a duração', () => {
    const e = statsEventFrom(row(req('a'), ok('Oi, chego às oito.', 'é oi chego às oito'), '2026-10-18T13:00:00.000Z'))!
    expect(e).toMatchObject({ id: 'a', mode: 'voice_transcript', app: 'WhatsApp.exe', words: 4, audio_seconds: 6, delivery: 'replace' })
    expect(e.local_day).toBe(localDay(new Date('2026-10-18T13:00:00.000Z')))
  })

  it('Just Ask conta o pedido falado, não a resposta', () => {
    const r = row(
      req('b', { mode: 'voice_command' }),
      ok('Uma resposta bem longa com muitas e muitas palavras aqui.', 'o que é isso', {
        delivery: 'reply',
        user_prompt: 'o que é isso',
        web_metadata: { query: 'x', sources: [{ title: 't', url: 'https://a.com' }] },
      }),
      '2026-10-18T13:00:00.000Z',
    )
    expect(statsEventFrom(r)).toMatchObject({ words: 4, delivery: 'reply', web_search: 1 })
  })

  it('erro não conta', () => {
    expect(statsEventFrom(row(req('c'), fail, '2026-10-18T13:00:00.000Z'))).toBeNull()
  })

  it('toque sem fala (texto vazio) não conta', () => {
    expect(statsEventFrom(row(req('d'), ok('', ''), '2026-10-18T13:00:00.000Z'))).toBeNull()
  })
})

describe('tempo economizado', () => {
  it('é o tempo digitando menos o tempo falando, nunca negativo', () => {
    expect(savedSeconds(40, 10, 40)).toBe(50) // 60 s digitando − 10 s falando
    expect(savedSeconds(2, 30, 40)).toBe(0)
  })

  it('formata a duração', () => {
    expect(formatDuration(42)).toBe('42 s')
    expect(formatDuration(12 * 60)).toBe('12 min')
    expect(formatDuration(2 * 3600 + 15 * 60)).toBe('2 h 15 min')
    expect(formatDuration(3600)).toBe('1 h')
  })
})

describe('sequência de dias', () => {
  it('conta até hoje e não quebra antes de o dia acabar', () => {
    const days = new Set(['2026-10-15', '2026-10-16', '2026-10-17'])
    expect(streaks(days, '2026-10-17')).toEqual({ current: 3, best: 3, activeToday: true })
    expect(streaks(days, '2026-10-18')).toEqual({ current: 3, best: 3, activeToday: false })
    expect(streaks(days, '2026-10-19').current).toBe(0)
  })

  it('guarda o recorde', () => {
    const days = new Set(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-10'])
    expect(streaks(days, '2026-10-10')).toEqual({ current: 1, best: 4, activeToday: true })
  })

  it('atravessa a virada do mês', () => {
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('resumo', () => {
  const now = new Date(2026, 9, 18, 15, 0) // 18/10/2026, horário local
  const events = [
    ev('2026-10-18', 40, { app: 'WhatsApp.exe', local_hour: 9 }),
    ev('2026-10-18', 20, { mode: 'voice_command', delivery: 'reply', web_search: 1 }),
    ev('2026-10-17', 100, { app: 'WhatsApp.exe', local_hour: 9 }),
    ev('2026-10-01', 500, { mode: 'voice_translation', local_hour: 22 }),
  ]
  const s = summarizeStats(events, { now, typingWpm: 40 })

  it('soma os totais, hoje e a semana', () => {
    expect(s.totals).toMatchObject({ words: 660, dictations: 4, audioSeconds: 40 })
    expect(s.today).toMatchObject({ words: 60, dictations: 2 })
    expect(s.week).toMatchObject({ words: 160, dictations: 3 })
    expect(s.totals.pages).toBe(2.6)
  })

  it('separa os modos e mede a velocidade sem o Just Ask', () => {
    expect(s.modes).toEqual({ transcript: 2, ask: 1, translation: 1, webSearches: 1 })
    expect(s.speakingWpm).toBe(Math.round(640 / (30 / 60)))
  })

  it('monta os 30 dias, os horários, os apps e os recordes', () => {
    expect(s.daily).toHaveLength(30)
    expect(s.daily[29]).toEqual({ day: '2026-10-18', words: 60, dictations: 2 })
    expect(s.hours[9]).toBe(140)
    expect(s.topApps[0]).toEqual({ app: 'Code', words: 520, dictations: 2 })
    expect(s.topApps[1]).toEqual({ app: 'WhatsApp', words: 140, dictations: 2 })
    expect(s.longest).toEqual({ words: 500, day: '2026-10-01' })
    expect(s.bestDay).toEqual({ words: 500, day: '2026-10-01' })
    expect(s.firstDay).toBe('2026-10-01')
    expect(s.streak).toEqual({ current: 2, best: 2, activeToday: true })
    expect(s.milestone).toEqual({ reached: 500, next: 1000 })
  })

  it('aceita a velocidade de digitação só dentro dos limites', () => {
    expect(summarizeStats([], { now, typingWpm: 5000 }).typingWpm).toBe(200)
    expect(summarizeStats([], { now, typingWpm: 0 }).typingWpm).toBe(40)
  })
})

describe('tabela de estatísticas', () => {
  it('migração preenche com os ditados que já estavam no histórico', () => {
    const raw = new DatabaseSync(':memory:')
    raw.exec(MIGRATIONS[0])
    raw.exec('PRAGMA user_version = 1')
    const old = new HistoryDb(raw) // abre a v1 e roda só a migração 2
    expect(old.version()).toBe(MIGRATIONS.length)
    expect(old.statEvents()).toHaveLength(0)

    const db = new HistoryDb(new DatabaseSync(':memory:'))
    db.upsert(row(req('a'), ok('um dois três'), '2026-10-18T10:00:00.000Z'))
    db.upsert(row(req('b'), fail, '2026-10-18T11:00:00.000Z'))
    db.backfillStats()
    expect(db.statEvents().map((e) => e.id)).toEqual(['a'])
  })

  it('refazer atualiza o evento em vez de somar outro, e apagar o histórico não zera', () => {
    const db = new HistoryDb(new DatabaseSync(':memory:'))
    const first = row(req('a'), ok('um dois'), '2026-10-18T10:00:00.000Z')
    db.upsert(first)
    db.recordStat(statsEventFrom(first)!)
    db.recordStat(statsEventFrom(row(req('a', { isRetry: true }), ok('um dois três quatro'), '2026-10-18T10:05:00.000Z'))!)
    expect(db.statEvents()).toHaveLength(1)
    expect(db.statEvents()[0]).toMatchObject({ words: 4, created_at: '2026-10-18T10:00:00.000Z' })
    db.deleteAll()
    expect(db.statEvents()).toHaveLength(1)
    db.resetStats()
    expect(db.statEvents()).toHaveLength(0)
  })
})
