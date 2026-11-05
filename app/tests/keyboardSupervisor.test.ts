import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeyboardRelay } from '../src/main/keyboard/relay'
import { restartDelay } from '../src/main/keyboard/supervisor'
import type { KeyboardSnapshot } from '../src/shared/ipc'

describe('backoff do processo do teclado', () => {
  it('espera 1, 2 e 4 s e desiste depois de 3 tentativas', () => {
    expect([0, 1, 2, 3].map(restartDelay)).toEqual([1000, 2000, 4000, null])
  })
})

describe('repasse com throttle de 16 ms e reenvio de 50 ms', () => {
  afterEach(() => vi.useRealTimers())

  const snap = (seq: number, pressingKeys: string[]): KeyboardSnapshot => ({
    seq,
    time: 0,
    type: 'down',
    key: '',
    swallowed: false,
    pressingKeys,
  })

  it('envia na hora, junta o que chega dentro de 16 ms e reenvia 50 ms depois', () => {
    vi.useFakeTimers()
    const sent: number[] = []
    const relay = new KeyboardRelay((s) => sent.push(s.seq), () => Date.now())
    relay.push(snap(1, ['RightAlt']))
    expect(sent).toEqual([1])
    vi.advanceTimersByTime(5)
    relay.push(snap(2, ['RightAlt', 'Space']))
    relay.push(snap(3, ['RightAlt']))
    expect(sent).toEqual([1])
    vi.advanceTimersByTime(11)
    expect(sent).toEqual([1, 3])
    vi.advanceTimersByTime(50)
    expect(sent).toEqual([1, 3, 3])
    relay.dispose()
  })
})
