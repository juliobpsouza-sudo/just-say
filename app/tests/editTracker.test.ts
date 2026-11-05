import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditTracker, type EditResult } from '../src/main/editTracker'
import type { FieldRead } from '../src/main/native/contextHelper'

function field(text: string, id = 'campo-1', over: Partial<FieldRead> = {}): FieldRead {
  return { id, pid: 1, controlType: 50004, frameworkId: 'Chrome', isEditable: true, isPassword: false, textKnown: true, text, ...over }
}

describe('rastreador de edição', () => {
  let current: FieldRead | null
  let results: EditResult[]
  let tracker: EditTracker

  beforeEach(() => {
    vi.useFakeTimers()
    current = null
    results = []
    tracker = new EditTracker({
      readField: async () => current,
      onEdit: (r) => results.push(r),
      now: () => Date.now(),
    })
  })
  afterEach(() => vi.useRealTimers())

  const key = (k: string) => tracker.onKey({ seq: 0, time: 0, type: 'down', key: k, swallowed: false, pressingKeys: [k] })

  it('pega a correção e termina no Enter', async () => {
    current = field('Oi Pedro, falei com o Marcus hoje.')
    tracker.start('s1', ' falei com o Marcus hoje.')
    await vi.advanceTimersByTimeAsync(900)
    current = field('Oi Pedro, falei com o Marcos hoje.')
    key('I')
    await vi.advanceTimersByTimeAsync(300)
    key('Enter')
    expect(results).toEqual([{ sessionId: 's1', before: 'falei com o Marcus hoje.', after: 'falei com o Marcos hoje.', end: 'enter' }])
  })

  it('termina quando o foco vai para outro campo, com o último texto lido', async () => {
    current = field('texto do Marcus')
    tracker.start('s1', 'texto do Marcus')
    await vi.advanceTimersByTimeAsync(900)
    current = field('texto do Marcos')
    await vi.advanceTimersByTimeAsync(1000)
    current = field('outro', 'campo-2')
    await vi.advanceTimersByTimeAsync(1000)
    expect(results.map((r) => [r.after, r.end])).toEqual([['texto do Marcos', 'field_changed']])
    expect(tracker.active).toBe(false)
  })

  it('campo limpo (mensagem enviada) usa o último texto antes de limpar', async () => {
    current = field('manda pro Marcus')
    tracker.start('s1', 'manda pro Marcus')
    await vi.advanceTimersByTimeAsync(900)
    current = field('manda pro Marcos')
    await vi.advanceTimersByTimeAsync(1000)
    current = field('')
    await vi.advanceTimersByTimeAsync(1000)
    expect(results.map((r) => [r.after, r.end])).toEqual([['manda pro Marcos', 'cleared']])
  })

  it('para em 15 s', async () => {
    current = field('sem mudança nenhuma aqui')
    tracker.start('s1', 'sem mudança nenhuma aqui')
    await vi.advanceTimersByTimeAsync(16_000)
    expect(tracker.active).toBe(false)
    expect(results).toEqual([])
  })

  it('reescrita grande não conta', async () => {
    current = field('oi tudo bem')
    tracker.start('s1', 'oi tudo bem')
    await vi.advanceTimersByTimeAsync(900)
    current = field('Prezado senhor, venho por meio desta comunicar')
    await vi.advanceTimersByTimeAsync(1000)
    key('Enter')
    expect(results).toEqual([])
  })

  it('não observa campo de senha nem campo onde o texto não entrou', async () => {
    current = field('segredo', 'c', { isPassword: true })
    tracker.start('s1', 'segredo')
    await vi.advanceTimersByTimeAsync(900)
    expect(tracker.active).toBe(false)
    current = field('outra coisa')
    tracker.start('s2', 'texto colado')
    await vi.advanceTimersByTimeAsync(900)
    expect(tracker.active).toBe(false)
  })
})
