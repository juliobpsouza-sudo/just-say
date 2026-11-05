import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor, fromPromise } from 'xstate'
import { TIMING } from '../src/shared/constants'
import type { RecordingFeature } from '../src/shared/shortcuts'
import {
  recordingMachine,
  stateName,
  type ChecksInput,
  type FinishInput,
  type RecordingResult,
} from '../src/renderer/src/recording/machine'

interface Options {
  checks?: () => Promise<void>
  finish?: (input: FinishInput) => Promise<RecordingResult>
  retry?: () => Promise<RecordingResult>
}

function start(opts: Options = {}) {
  const calls = { start: 0, release: 0, discard: 0, inserted: [] as string[], finish: [] as FinishInput[] }
  const machine = recordingMachine.provide({
    actors: {
      runChecks: fromPromise<void, ChecksInput>(() => (opts.checks ? opts.checks() : Promise.resolve())),
      finishRecording: fromPromise<RecordingResult, FinishInput>(({ input }) => {
        calls.finish.push(input)
        return opts.finish ? opts.finish(input) : Promise.resolve({ text: 'olá mundo' })
      }),
      discardRecording: fromPromise<void, { sessionId: string | null }>(async () => {
        calls.discard++
      }),
      retryRecording: fromPromise<RecordingResult, ChecksInput>(() =>
        opts.retry ? opts.retry() : Promise.resolve({ text: 'refeito' }),
      ),
    },
    actions: {
      startRecording: () => {
        calls.start++
      },
      releaseRecording: () => {
        calls.release++
      },
      insertResult: (_, params) => {
        calls.inserted.push(params.result.text)
      },
    },
  })
  let seq = 0
  const actor = createActor(machine, { input: { now: () => Date.now(), newSessionId: () => `s${++seq}` } })
  actor.start()
  const state = () => stateName(actor.getSnapshot().value)
  const send = (e: Parameters<typeof actor.send>[0]) => actor.send(e)
  const down = (feature: RecordingFeature = 'dictation') =>
    send({ type: 'PRIMARY_KEY.DOWN', feature, at: Date.now() })
  const up = (feature: RecordingFeature = 'dictation') => send({ type: 'PRIMARY_KEY.UP', feature, at: Date.now() })
  return { actor, state, send, down, up, calls }
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('máquina de gravação', () => {
  it('toque percorre idle → initializing → awaiting → recording_active.handsFree', async () => {
    const m = start()
    expect(m.state()).toBe('idle')
    m.down()
    expect(m.state()).toBe('initializingForTapOrHold')
    expect(m.calls.start).toBe(1) // grava já no keydown
    await tick(0)
    expect(m.state()).toBe('awaiting_long_press_or_tap')
    await tick(80)
    m.up()
    expect(m.state()).toBe('recording_active.handsFree')
  })

  it('segundo toque termina, processa e insere', async () => {
    const m = start()
    m.down()
    await tick(50)
    m.up()
    await tick(2000)
    m.down()
    expect(m.state()).toBe('finishing')
    await tick(0)
    expect(m.state()).toBe('idle')
    expect(m.calls.inserted).toEqual(['olá mundo'])
    expect(m.calls.finish[0]).toMatchObject({ mode: 'transcript', reason: 'tap', sessionId: 's1' })
  })

  it('segurar 600 ms vai para long_pressing e descarta ao soltar', async () => {
    const m = start()
    m.down()
    await tick(TIMING.LONG_PRESS_MS - 1)
    expect(m.state()).toBe('awaiting_long_press_or_tap')
    await tick(1)
    expect(m.state()).toBe('long_pressing')
    expect(m.actor.getSnapshot().context.alert).toBe('dont_hold')
    expect(m.calls.release).toBe(1)
    m.up()
    await tick(0)
    expect(m.state()).toBe('idle')
    expect(m.calls.discard).toBe(1)
  })

  it('long press também vale enquanto as checagens ainda rodam', async () => {
    const m = start({ checks: () => new Promise(() => {}) })
    m.down()
    await tick(TIMING.LONG_PRESS_MS)
    expect(m.state()).toBe('long_pressing')
  })

  it('soltar durante a inicialização vai direto para gravação quando as checagens terminam', async () => {
    let finishChecks!: () => void
    const m = start({ checks: () => new Promise<void>((r) => (finishChecks = r)) })
    m.down()
    await tick(40)
    m.up()
    expect(m.state()).toBe('initializingForTapOrHold')
    await tick(TIMING.LONG_PRESS_MS) // passa dos 600 ms, mas a tecla já foi solta
    expect(m.state()).toBe('initializingForTapOrHold')
    finishChecks()
    await tick(0)
    expect(m.state()).toBe('recording_active.handsFree')
  })

  it('ignora toque repetido em menos de 300 ms (debounce)', async () => {
    const m = start()
    m.down()
    await tick(50)
    m.up()
    await tick(TIMING.DEBOUNCE_MS - 100)
    m.down()
    expect(m.state()).toBe('recording_active.handsFree')
    await tick(100)
    m.down()
    expect(m.state()).toBe('finishing')
  })

  it('tecla errada durante a inicialização cancela', async () => {
    const m = start({ checks: () => new Promise(() => {}) })
    m.down()
    m.send({ type: 'WRONG_KEY.DOWN', key: 'Q', at: Date.now() })
    expect(m.state()).toBe('stopping')
    await tick(0)
    expect(m.state()).toBe('idle')
    expect(m.calls.discard).toBe(1)
  })

  it('tradução grava em recording_active.translationModeHandsFree', async () => {
    const m = start()
    m.down('translation')
    expect(m.state()).toBe('initializingForTranslation')
    await tick(30)
    m.up('translation')
    expect(m.state()).toBe('recording_active.translationModeHandsFree')
  })

  it('Ask Anything usa initializingForHandsFree', async () => {
    const m = start()
    m.down('askAnything')
    expect(m.state()).toBe('initializingForHandsFree')
    await tick(30)
    m.up('askAnything')
    expect(m.state()).toBe('recording_active.handsFree')
    expect(m.actor.getSnapshot().context.mode).toBe('ask_anything')
  })

  it('trocar de modo segurando a tecla não reinicia os 600 ms', async () => {
    const m = start({ checks: () => new Promise(() => {}) })
    m.down('dictation')
    await tick(300)
    m.send({ type: 'SWITCH_MODE', feature: 'askAnything', at: Date.now() })
    expect(m.state()).toBe('initializingForHandsFree')
    expect(m.actor.getSnapshot().context.mode).toBe('ask_anything')
    await tick(TIMING.LONG_PRESS_MS - 300)
    expect(m.state()).toBe('long_pressing')
  })

  it('Escape durante a gravação descarta', async () => {
    const m = start()
    m.down()
    await tick(30)
    m.up()
    m.send({ type: 'CANCEL', at: Date.now() })
    expect(m.state()).toBe('stopping')
    await tick(0)
    expect(m.state()).toBe('idle')
    expect(m.calls.inserted).toEqual([])
  })

  it('contagem regressiva no último minuto e fim automático aos 9 min', async () => {
    const m = start()
    m.down()
    await tick(30)
    m.up()
    await tick(TIMING.MAX_DURATION_MS - TIMING.COUNTDOWN_MS - 10)
    expect(m.actor.getSnapshot().context.countdown).toBe(false)
    await tick(20)
    expect(m.actor.getSnapshot().context.countdown).toBe(true)
    await tick(TIMING.COUNTDOWN_MS - 10)
    expect(m.calls.finish).toHaveLength(1)
    expect(m.calls.finish[0].reason).toBe('timeout')
  })

  it('sem fala detectada vira erro recuperável e volta a idle', async () => {
    const m = start()
    m.down()
    await tick(30)
    m.up()
    m.send({ type: 'NO_SPEECH' })
    expect(m.state()).toBe('error')
    expect(m.actor.getSnapshot().context.error?.code).toBe('RECOVERABLE_NO_SPEECH_DETECTED')
    await tick(4000)
    expect(m.state()).toBe('idle')
  })

  it('erro recuperável permite refazer', async () => {
    const m = start({ finish: () => Promise.reject({ code: 'RECOVERABLE_NETWORK', message: 'rede', recoverable: true }) })
    m.down()
    await tick(30)
    m.up()
    await tick(500)
    m.down()
    await tick(0)
    expect(m.state()).toBe('error')
    m.send({ type: 'RETRY' })
    expect(m.state()).toBe('retrying')
    await tick(0)
    expect(m.state()).toBe('idle')
    expect(m.calls.inserted).toEqual(['refeito'])
  })

  it('erro não recuperável vai para failure', async () => {
    const m = start({ finish: () => Promise.reject(new Error('quebrou')) })
    m.down()
    await tick(30)
    m.up()
    await tick(500)
    m.down()
    await tick(0)
    expect(m.state()).toBe('failure')
    await tick(4000)
    expect(m.state()).toBe('idle')
  })
})
