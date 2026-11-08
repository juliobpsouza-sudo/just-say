import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { HistoryDb, MIGRATIONS, retentionCutoff } from '../src/main/history/historyDb'
import { ftsQuery, historyItemFrom, historyRowFrom, storedRequestFrom } from '../src/shared/history'
import type { VoiceFlowRequest, VoiceFlowResult } from '../src/shared/voiceFlow'

const req = (id: string, over: Partial<VoiceFlowRequest> = {}): VoiceFlowRequest => ({
  requestId: id,
  audioId: id,
  mode: 'voice_transcript',
  audioContext: { active_application: { name: 'Chrome', browser_context: { domain: 'mail.google.com' } } },
  audioMetadata: { duration_ms: 4200 },
  userOverTime: 0,
  sendTime: 0,
  isRetry: false,
  parameters: { languages: [] },
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

function newDb() {
  return new HistoryDb(new DatabaseSync(':memory:'))
}

function save(db: HistoryDb, r: VoiceFlowRequest, result: VoiceFlowResult, now: string) {
  db.upsert(historyRowFrom(r, result, { now, appVersion: '0.1.0', audioPath: `C:/r/${r.audioId}.wav`, previous: db.get(r.audioId) }))
}

describe('banco do histórico', () => {
  it('cria o esquema pelas migrações', () => {
    const db = newDb()
    expect(db.version()).toBe(MIGRATIONS.length)
    expect(db.count()).toBe(0)
  })

  it('grava, lê e converte para a tela', () => {
    const db = newDb()
    save(db, req('a'), ok('Reunião às 16h.', 'é reunião às quatro'), '2026-10-14T10:00:00.000Z')
    const row = db.get('a')!
    expect(row).toMatchObject({ status: 'completed', refined_text: 'Reunião às 16h.', duration: 4.2, focused_app: 'Chrome' })
    expect(historyItemFrom(row, true)).toMatchObject({
      text: 'Reunião às 16h.',
      rawText: 'é reunião às quatro',
      domain: 'mail.google.com',
      delivery: 'replace',
      hasAudio: true,
    })
  })

  it('refazer atualiza a mesma linha e mantém a data de criação', () => {
    const db = newDb()
    save(db, req('a'), fail, '2026-10-14T10:00:00.000Z')
    expect(db.get('a')).toMatchObject({ status: 'error', error_message: 'sem STT' })
    save(db, req('a', { isRetry: true }), ok('Agora foi.'), '2026-10-14T11:00:00.000Z')
    expect(db.get('a')).toMatchObject({
      status: 'completed',
      refined_text: 'Agora foi.',
      created_at: '2026-10-14T10:00:00.000Z',
      updated_at: '2026-10-14T11:00:00.000Z',
      error_message: null,
    })
    expect(db.count()).toBe(1)
  })

  it('busca sem acento, por prefixo, no texto e no pedido do Just Ask', () => {
    const db = newDb()
    save(db, req('a'), ok('Reunião amanhã cedo.'), '2026-10-14T10:00:00.000Z')
    save(db, req('b'), ok('Comprar café para o escritório.'), '2026-10-14T10:01:00.000Z')
    save(
      db,
      req('c', { mode: 'voice_command', parameters: { selected_text: 'oi' } }),
      ok('34,5', 'quanto é 15% de 230', { delivery: 'reply', user_prompt: 'quanto é 15% de 230' }),
      '2026-10-14T10:02:00.000Z',
    )
    expect(db.list({ text: 'reuniao' }).rows.map((r) => r.id)).toEqual(['a'])
    expect(db.list({ text: 'escrit' }).rows.map((r) => r.id)).toEqual(['b'])
    expect(db.list({ text: 'quanto 230' }).rows.map((r) => r.id)).toEqual(['c'])
    expect(db.list({ mode: 'voice_command' }).rows.map((r) => r.id)).toEqual(['c'])
    expect(db.list({ text: '"; DROP TABLE history_v2; --' }).rows).toEqual([])
    expect(db.count()).toBe(3)
  })

  it('pagina do mais novo para o mais velho', () => {
    const db = newDb()
    for (let i = 0; i < 5; i++) save(db, req(`id${i}`), ok(`texto ${i}`), `2026-10-14T10:0${i}:00.000Z`)
    const p1 = db.list({ limit: 2 })
    expect(p1.rows.map((r) => r.id)).toEqual(['id4', 'id3'])
    const p2 = db.list({ limit: 2, before: p1.next })
    expect(p2.rows.map((r) => r.id)).toEqual(['id2', 'id1'])
    const p3 = db.list({ limit: 2, before: p2.next })
    expect(p3.rows.map((r) => r.id)).toEqual(['id0'])
    expect(p3.next).toBeNull()
  })

  it('apaga (também da busca) e aplica o tempo de guarda', () => {
    const db = newDb()
    save(db, req('velho'), ok('texto velho'), '2026-01-01T00:00:00.000Z')
    save(db, req('novo'), ok('texto novo'), '2026-10-14T00:00:00.000Z')
    const cutoff = retentionCutoff(30 * 86_400, Date.parse('2026-10-14T12:00:00.000Z'))!
    expect(db.deleteOlderThan(cutoff).map((r) => r.id)).toEqual(['velho'])
    expect(db.list({ text: 'velho' }).rows).toEqual([])
    expect(db.delete(['novo'])[0].audio_local_path).toBe('C:/r/novo.wav')
    expect(db.count()).toBe(0)
  })

  it('guardar para sempre não tem corte', () => {
    expect(retentionCutoff(-1, Date.now())).toBeNull()
  })

  it('amostras de estilo: ditados concluídos, preferindo o texto editado', () => {
    const db = newDb()
    save(db, req('a'), ok('Oi Marcus'), '2026-10-14T10:00:00.000Z')
    db.setEditedText('a', 'Oi Marcos')
    save(db, req('b', { mode: 'voice_translation' }), ok('Hello'), '2026-10-14T10:01:00.000Z')
    save(db, req('c'), fail, '2026-10-14T10:02:00.000Z')
    expect(db.recentDictationTexts(10)).toEqual(['Oi Marcos'])
  })

  it('pedido salvo serve para refazer igual', () => {
    const row = historyRowFrom(req('a', { mode: 'voice_translation', parameters: { output_language: 'en' } }), ok('Hi'), {
      now: 'x',
      appVersion: '1',
      audioPath: null,
    })
    expect(storedRequestFrom(row)).toMatchObject({ parameters: { output_language: 'en' }, audioMetadata: { duration_ms: 4200 } })
    expect(historyItemFrom(row, false).outputLanguage).toBe('en')
  })
})

describe('consulta de busca', () => {
  it('vira prefixos entre aspas e ignora operadores', () => {
    expect(ftsQuery('Reunião amanhã')).toBe('"reunião"* "amanhã"*')
    expect(ftsQuery('a OR b')).toBe('"a"* "or"* "b"*')
    expect(ftsQuery('  ""  ')).toBeNull()
  })
})
