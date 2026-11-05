import { describe, expect, it } from 'vitest'
import { partOverview, shortModelName, usageOverview, type ProviderUsage, type UsageReport } from '../src/shared/usage'

const groq = (id: string, label: string, kind: 'stt' | 'llm', requests: [number, number], over: Partial<ProviderUsage> = {}): ProviderUsage => ({
  id,
  label,
  kind,
  enabled: true,
  unlimited: false,
  observed: true,
  requests: { remaining: requests[0], limit: requests[1] },
  ...over,
})

const report = (providers: ProviderUsage[], dictations: number | null = 100): UsageReport => ({
  at: 0,
  dictationsWithRefine: dictations,
  dictationsTranscriptOnly: 0,
  providers,
})

describe('uso gratuito resumido', () => {
  it('encurta o nome do modelo', () => {
    expect(shortModelName('Groq · openai/gpt-oss-120b')).toBe('gpt-oss-120b')
    expect(shortModelName('Groq · whisper-large-v3-turbo')).toBe('whisper-large-v3-turbo')
    expect(shortModelName('Whisper local (sua GPU)')).toBe('Whisper local (sua GPU)')
  })

  it('o modelo em uso é o 1º ligado com limite; os outros ligados são reserva', () => {
    const p = partOverview([
      groq('a', 'Groq · qwen/qwen3.8-27b', 'llm', [992, 1000]),
      groq('b', 'Groq · openai/gpt-oss-120b', 'llm', [1000, 1000]),
      groq('c', 'Groq · openai/gpt-oss-20b', 'llm', [1000, 1000], { enabled: false }),
    ])
    expect(p).toEqual({ model: 'qwen3.8-27b', ratio: 0.992, barTone: 'ok', tone: 'ok', reserves: 1 })
  })

  it('pula o modelo com uma janela zerada (tokens do minuto)', () => {
    const p = partOverview([
      groq('a', 'Groq · qwen/qwen3.8-27b', 'llm', [500, 1000], { tokens: { remaining: 0, limit: 8000 } }),
      groq('b', 'Groq · openai/gpt-oss-120b', 'llm', [900, 1000]),
    ])
    expect(p.model).toBe('gpt-oss-120b')
  })

  it('a folga soma as reservas; a barra é só do modelo em uso', () => {
    const p = partOverview([groq('a', 'A', 'stt', [100, 2000]), groq('b', 'B', 'stt', [2000, 2000])])
    expect(p.barTone).toBe('warn')
    expect(p.tone).toBe('ok')
  })

  it('modelo sem limite deixa tudo folgado', () => {
    const p = partOverview([groq('a', 'A', 'stt', [0, 2000]), { ...groq('w', 'Whisper local (sua GPU)', 'stt', [0, 0]), unlimited: true, requests: undefined }])
    expect(p).toMatchObject({ model: 'Whisper local (sua GPU)', ratio: null, tone: 'ok' })
  })

  it('nada ligado ou nada sobrando é esgotado', () => {
    expect(partOverview([]).tone).toBe('bad')
    expect(partOverview([groq('a', 'A', 'stt', [0, 2000])]).tone).toBe('bad')
  })

  it('o estado geral é o pior das duas partes, e esgotado sem ditados', () => {
    const stt = groq('s', 'S', 'stt', [2000, 2000])
    const llm = groq('l', 'L', 'llm', [200, 1000])
    expect(usageOverview(report([stt, llm])).tone).toBe('warn')
    expect(usageOverview(report([stt, groq('l', 'L', 'llm', [900, 1000])], 0)).tone).toBe('bad')
    expect(usageOverview(report([stt, groq('n', 'Sem refino', 'llm', [0, 0], { id: 'none', unlimited: true })])).llm.model).toBeNull()
  })
})
