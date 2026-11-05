import { describe, expect, it } from 'vitest'
import { AllProvidersFailedError, allNetworkFailures, Cascade } from '../src/providers/cascade.ts'
import { isRequestTooLarge, parseGroqDuration, retryAfterFromHeaders } from '../src/providers/groq.ts'
import {
  ProviderLimitError,
  ProviderNetworkError,
  ProviderRequestTooLargeError,
  ProviderUnavailableError,
  type ProviderInfo,
} from '../src/providers/types.ts'

interface Fake extends ProviderInfo {
  behavior: 'ok' | 'limit' | 'down' | 'too_large' | 'offline'
}

const fake = (id: string, behavior: Fake['behavior'] = 'ok'): Fake => ({
  id,
  label: id,
  free: true,
  behavior,
  isConfigured: () => true,
})

function setup(providers: Fake[], enabled: Record<string, boolean> = {}) {
  let now = 1_000_000
  const cascade = new Cascade<Fake>(
    providers,
    () => providers.map((p) => ({ id: p.id, enabled: enabled[p.id] ?? true })),
    () => now,
  )
  const call = (p: Fake) => {
    if (p.behavior === 'limit') return Promise.reject(new ProviderLimitError('limite', 60_000))
    if (p.behavior === 'down') return Promise.reject(new ProviderUnavailableError('fora'))
    if (p.behavior === 'offline') return Promise.reject(new ProviderNetworkError('sem conexão'))
    if (p.behavior === 'too_large') return Promise.reject(new ProviderRequestTooLargeError('grande'))
    return Promise.resolve(p.id)
  }
  const run = (skip?: (p: Fake) => boolean) =>
    cascade.run((p) => call(p), { deadline: now + 10_000, perProviderTimeoutMs: 5000, skip })
  return { cascade, run, advance: (ms: number) => (now += ms) }
}

describe('cascata de provedores', () => {
  it('usa o primeiro da lista quando ele responde', async () => {
    const { run } = setup([fake('a'), fake('b')])
    expect((await run()).value).toBe('a')
  })

  it('pula para o próximo quando o limite gratuito acaba e marca "esgotado até"', async () => {
    const a = fake('a', 'limit')
    const { run, cascade, advance } = setup([a, fake('b')])
    const r = await run()
    expect(r.value).toBe('b')
    expect(r.attempts.map((x) => x.ok)).toEqual([false, true])
    const status = cascade.status().find((s) => s.id === 'a')!
    expect(status.blockReason).toBe('limit')
    expect(status.blockedUntil).toBe(1_000_000 + 60_000)

    // Enquanto esgotado, nem tenta o "a".
    a.behavior = 'ok'
    expect((await run()).attempts.map((x) => x.provider)).toEqual(['b'])

    // Passado o prazo, volta a ser o primeiro.
    advance(60_001)
    expect((await run()).value).toBe('a')
  })

  it('provedor fora do ar fica de lado por um tempo curto', async () => {
    const { run, cascade } = setup([fake('a', 'down'), fake('b')])
    expect((await run()).value).toBe('b')
    expect(cascade.status()[0].blockReason).toBe('unavailable')
  })

  it('respeita a ordem e o liga/desliga da configuração', async () => {
    const { run } = setup([fake('a'), fake('b')], { a: false })
    expect((await run()).value).toBe('b')
  })

  it('quando todos falham, informa cada tentativa', async () => {
    const { run } = setup([fake('a', 'limit'), fake('b', 'down')])
    await expect(run()).rejects.toBeInstanceOf(AllProvidersFailedError)
  })

  it('pedido grande demais pula para o próximo sem bloquear (D57)', async () => {
    const a = fake('a', 'too_large')
    const { run, cascade } = setup([a, fake('b')])
    const r = await run()
    expect(r.value).toBe('b')
    expect(r.attempts[0].failure).toBe('too_large')
    expect(cascade.status()[0].blockedUntil).toBeNull()
    a.behavior = 'ok'
    expect((await run()).value).toBe('a')
  })

  it('pula os provedores marcados por skip (ex.: o sem refino no Ask Anything)', async () => {
    const { run } = setup([fake('a'), fake('none')])
    expect((await run((p) => p.id === 'a')).value).toBe('none')
    await expect(run(() => true)).rejects.toBeInstanceOf(AllProvidersFailedError)
  })

  it('liberar à mão tira o bloqueio', async () => {
    const a = fake('a', 'limit')
    const { run, cascade } = setup([a, fake('b')])
    await run()
    a.behavior = 'ok'
    cascade.clearBlock('a')
    expect((await run()).value).toBe('a')
  })

  it('sem internet: marca "network", não bloqueia e volta assim que a conexão volta', async () => {
    const a = fake('a', 'offline')
    const b = fake('b', 'offline')
    const { run, cascade } = setup([a, b])
    const err = await run().catch((e) => e)
    expect(err).toBeInstanceOf(AllProvidersFailedError)
    expect(err.attempts.map((x: { failure: string }) => x.failure)).toEqual(['network', 'network'])
    expect(allNetworkFailures(err.attempts)).toBe(true)
    expect(cascade.status().every((s) => s.blockedUntil === null)).toBe(true)
    a.behavior = 'ok'
    expect((await run()).value).toBe('a')
  })

  it('falha mista (rede + provedor fora) não conta como "sem internet"', async () => {
    const { run } = setup([fake('a', 'offline'), fake('b', 'down')])
    const err = await run().catch((e) => e)
    expect(allNetworkFailures(err.attempts)).toBe(false)
    expect(allNetworkFailures([])).toBe(false)
  })
})

describe('cabeçalhos de limite do Groq', () => {
  it('reconhece o 429 de pedido grande demais', () => {
    expect(isRequestTooLarge('{"error":{"message":"Request too large for model ... (OTPM): Limit 1000, Requested 1024"}}')).toBe(true)
    expect(isRequestTooLarge('{"error":{"message":"Rate limit reached for model"}}')).toBe(false)
  })

  it('converte as durações do Groq em ms', () => {
    expect(parseGroqDuration('43.2s')).toBe(43_200)
    expect(parseGroqDuration('500ms')).toBe(500)
    expect(parseGroqDuration('1m30s')).toBe(90_000)
    expect(parseGroqDuration('2h0m5s')).toBe(7_205_000)
    expect(parseGroqDuration(null)).toBeNull()
  })

  it('usa retry-after quando existe, senão o maior reset', () => {
    expect(retryAfterFromHeaders(new Headers({ 'retry-after': '12' }))).toBe(12_000)
    expect(
      retryAfterFromHeaders(
        new Headers({ 'x-ratelimit-reset-requests': '43.2s', 'x-ratelimit-reset-tokens': '2m' }),
      ),
    ).toBe(120_000)
  })

  it('sem retry-after, usa o reset do balde que esvaziou (D92)', () => {
    expect(
      retryAfterFromHeaders(
        new Headers({
          'x-ratelimit-remaining-tokens': '0',
          'x-ratelimit-reset-tokens': '7.66s',
          'x-ratelimit-remaining-requests': '990',
          'x-ratelimit-reset-requests': '2m59s',
        }),
      ),
    ).toBe(7_660)
  })
})
