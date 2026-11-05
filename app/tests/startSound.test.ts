import { describe, expect, it } from 'vitest'
import { decideStartSoundDelay } from '../src/shared/startSound'

const route = (sameDevice: boolean, bluetooth: boolean) => ({ micName: 'fone', outputName: 'fone', sameDevice, bluetooth })

describe('atraso do som de início', () => {
  it('automático: atrasa 1,2 s só com fone Bluetooth que é microfone e saída ao mesmo tempo', () => {
    expect(decideStartSoundDelay('auto', route(true, true)).delayMs).toBe(1200)
    expect(decideStartSoundDelay('auto', route(true, false)).delayMs).toBe(0) // fone USB
    expect(decideStartSoundDelay('auto', route(false, true)).delayMs).toBe(0)
  })

  it('sempre e nunca ignoram a detecção', () => {
    expect(decideStartSoundDelay('always', route(false, false)).delayMs).toBe(1200)
    expect(decideStartSoundDelay('never', route(true, true)).delayMs).toBe(0)
  })
})
