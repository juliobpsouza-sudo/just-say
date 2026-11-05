import { describe, expect, it } from 'vitest'
import { estimateNow, snapshotFromHeaders, tightestRatio } from '../src/usage.ts'
import { buildNotices, capacity, limitPhrase, type ProviderUsageView } from '../src/usageReport.ts'

describe('uso gratuito a partir dos cabeçalhos do Groq', () => {
  it('lê pedidos, tokens e segundos de áudio', () => {
    const snap = snapshotFromHeaders(
      new Headers({
        'x-ratelimit-limit-requests': '2000',
        'x-ratelimit-remaining-requests': '1999',
        'x-ratelimit-limit-audio-seconds': '7200',
        'x-ratelimit-remaining-audio-seconds': '7190',
      }),
      1000,
    )
    expect(snap).toEqual({
      at: 1000,
      requests: { limit: 2000, remaining: 1999 },
      audioSeconds: { limit: 7200, remaining: 7190 },
    })
  })

  it('sem cabeçalhos de limite devolve null', () => {
    expect(snapshotFromHeaders(new Headers(), 0)).toBeNull()
  })

  it('estima a recarga: 2.000/dia recarrega 1 pedido a cada 43,2 s', () => {
    const snap = { at: 0, requests: { limit: 2000, remaining: 1990 } }
    expect(estimateNow(snap, 43_200).requests).toEqual({ limit: 2000, remaining: 1991 })
    expect(estimateNow(snap, 432_000).requests).toEqual({ limit: 2000, remaining: 2000 })
    expect(estimateNow(snap, 10 * 86_400_000).requests!.remaining).toBe(2000) // nunca passa do limite
  })

  it('tokens por minuto recarregam no minuto', () => {
    const snap = { at: 0, tokens: { limit: 8000, remaining: 0 } }
    expect(estimateNow(snap, 30_000).tokens!.remaining).toBe(4000)
  })

  it('o limite mais apertado manda', () => {
    expect(tightestRatio({ at: 0, requests: { limit: 1000, remaining: 900 }, tokens: { limit: 8000, remaining: 800 } })).toBe(0.1)
  })
})

describe('capacidade da cascata', () => {
  const v = (id: string, remaining: number, enabled = true, unlimited = false): ProviderUsageView => ({
    id,
    label: id,
    kind: 'stt',
    enabled,
    unlimited,
    observed: true,
    requests: { limit: 2000, remaining },
  })

  it('soma os ligados e ignora os desligados', () => {
    expect(capacity([v('a', 1500), v('b', 2000), v('c', 999, false)])).toBe(3500)
  })

  it('um provedor sem limite (Whisper local) deixa a capacidade infinita', () => {
    expect(capacity([v('a', 10), v('local', 0, true, true)])).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('avisos para a barra', () => {
  it('avisa quando um modelo bateu no limite e diz qual assumiu', () => {
    const notices = buildNotices(
      [
        { provider: 'groq:qwen/qwen3.8-27b', ok: false, ms: 50, failure: 'limit', error: 'limite' },
        { provider: 'groq:openai/gpt-oss-120b', ok: true, ms: 400 },
      ],
      [],
    )
    expect(notices).toEqual(['Groq · qwen/qwen3.8-27b chegou ao limite gratuito. Usando Groq · openai/gpt-oss-120b.'])
  })

  it('limite por minuto não parece limite do dia (D92)', () => {
    const notices = buildNotices(
      [
        { provider: 'groq:qwen/qwen3.8-27b', ok: false, ms: 50, failure: 'limit', retryAfterMs: 7_660 },
        { provider: 'groq:openai/gpt-oss-120b', ok: true, ms: 400 },
      ],
      [],
    )
    expect(notices).toEqual(['Groq · qwen/qwen3.8-27b bateu o limite por minuto (volta em 8 s). Usando Groq · openai/gpt-oss-120b.'])
    expect(limitPhrase(5 * 3_600_000)).toBe('chegou ao limite gratuito (volta em 5 h)')
    expect(limitPhrase(600_000)).toBe('chegou ao limite gratuito (volta em 10 min)')
  })

  it('não avisa sobre falha que não é de limite', () => {
    expect(
      buildNotices([{ provider: 'groq:whisper-large-v3-turbo', ok: false, ms: 50, failure: 'timeout' }], []),
    ).toEqual([])
  })
})
