// Máquina de gravação (id `recording`), com os estados:
// idle, initializingForTapOrHold/HandsFree/Translation, awaiting_long_press_or_tap,
// long_pressing, recording_active.{handsFree, translationModeHandsFree}, stopping,
// finishing, retrying, error e failure. As transições exatas estão em DECISOES.md.
//
// Efeitos (gravar, terminar, descartar, inserir) entram por `provide`, para a máquina
// ser testável sem Electron.
import { assign, fromPromise, setup } from 'xstate'
import { TIMING } from '../../../shared/constants'
import type { RecordingFeature } from '../../../shared/shortcuts'

export type RecordingMode = 'transcript' | 'ask_anything' | 'translation'

export const FEATURE_MODE: Record<RecordingFeature, RecordingMode> = {
  dictation: 'transcript',
  askAnything: 'ask_anything',
  translation: 'translation',
}

export type ErrorCode =
  | 'RECOVERABLE_NO_SPEECH_DETECTED'
  | 'RECOVERABLE_NETWORK'
  | 'RECOVERABLE_TIMEOUT'
  | 'INIT_CHECK_FAILED'
  | 'UNKNOWN'

export interface RecordingError {
  code: ErrorCode
  message: string
  recoverable: boolean
}

export interface RecordingResult {
  text: string
}

export type Alert = 'dont_hold' | 'wrong_key' | null

export interface RecordingContext {
  sessionId: string | null
  feature: RecordingFeature | null
  mode: RecordingMode | null
  keyDownAt: number
  keyReleased: boolean
  lastPrimaryDownAt: number
  recordingStartedAt: number | null
  countdown: boolean
  stopReason: 'tap' | 'timeout' | null
  error: RecordingError | null
  result: RecordingResult | null
  alert: Alert
  now: () => number
  newSessionId: () => string
}

export type RecordingEvent =
  | { type: 'PRIMARY_KEY.DOWN'; feature: RecordingFeature; at: number }
  | { type: 'PRIMARY_KEY.UP'; feature: RecordingFeature; at: number }
  | { type: 'SWITCH_MODE'; feature: RecordingFeature; at: number }
  | { type: 'WRONG_KEY.DOWN'; key: string; at: number }
  | { type: 'CANCEL'; at: number }
  | { type: 'NO_SPEECH' }
  | { type: 'RETRY' }
  | { type: 'DISMISS' }

export interface ChecksInput {
  sessionId: string | null
  mode: RecordingMode | null
}

export interface FinishInput {
  sessionId: string
  mode: RecordingMode
  reason: 'tap' | 'timeout' | null
}

export interface MachineInput {
  now?: () => number
  newSessionId?: () => string
}

export function toRecordingError(err: unknown, fallback: ErrorCode): RecordingError {
  if (err && typeof err === 'object' && 'code' in err) {
    const e = err as Partial<RecordingError>
    return {
      code: (e.code as ErrorCode) ?? fallback,
      message: e.message ?? 'Erro desconhecido',
      recoverable: e.recoverable ?? false,
    }
  }
  return { code: fallback, message: err instanceof Error ? err.message : String(err), recoverable: false }
}

let fallbackSeq = 0
const defaultSessionId = () => globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}-${++fallbackSeq}`

const startTransitions = [
  { guard: 'canStartDictation', target: '#recording.initializingForTapOrHold', actions: 'beginSession' },
  { guard: 'canStartAskAnything', target: '#recording.initializingForHandsFree', actions: 'beginSession' },
  { guard: 'canStartTranslation', target: '#recording.initializingForTranslation', actions: 'beginSession' },
] as const

const switchTransitions = [
  { guard: 'switchToDictation', target: '#recording.initializingForTapOrHold', actions: 'switchMode' },
  { guard: 'switchToAskAnything', target: '#recording.initializingForHandsFree', actions: 'switchMode' },
  { guard: 'switchToTranslation', target: '#recording.initializingForTranslation', actions: 'switchMode' },
] as const

const checksInput = ({ context }: { context: RecordingContext }): ChecksInput => ({
  sessionId: context.sessionId,
  mode: context.mode,
})

// Os três estados de inicialização têm o mesmo comportamento; muda só o nome (e o modo).
function initializingState() {
  return {
    entry: 'startRecording',
    invoke: {
      src: 'runChecks',
      input: checksInput,
      onDone: { target: '#recording.awaiting_long_press_or_tap' },
      onError: { target: '#recording.error', actions: 'setInitError' },
    },
    after: { LONG_PRESS: { guard: 'keyHeld', target: '#recording.long_pressing' } },
    on: {
      'PRIMARY_KEY.UP': { actions: 'markKeyReleased' },
      SWITCH_MODE: switchTransitions,
      'WRONG_KEY.DOWN': { target: '#recording.stopping', actions: 'setWrongKeyAlert' },
      CANCEL: { target: '#recording.stopping' },
    },
  } as const
}

export const recordingMachine = setup({
  types: {
    context: {} as RecordingContext,
    events: {} as RecordingEvent,
    input: {} as MachineInput,
  },
  actors: {
    runChecks: fromPromise<void, ChecksInput>(async () => {}),
    finishRecording: fromPromise<RecordingResult, FinishInput>(async () => ({ text: '' })),
    discardRecording: fromPromise<void, { sessionId: string | null }>(async () => {}),
    retryRecording: fromPromise<RecordingResult, ChecksInput>(async () => ({ text: '' })),
  },
  actions: {
    // Efeitos: implementados pela barra flutuante via `provide`.
    startRecording: () => {},
    releaseRecording: () => {},
    insertResult: (_, _params: { result: RecordingResult }) => {},
    onRecordingActive: () => {},
    onRecordingInactive: () => {},

    beginSession: assign(({ context, event }) => {
      const e = event as Extract<RecordingEvent, { type: 'PRIMARY_KEY.DOWN' }>
      return {
        sessionId: context.newSessionId(),
        feature: e.feature,
        mode: FEATURE_MODE[e.feature],
        keyDownAt: e.at,
        keyReleased: false,
        lastPrimaryDownAt: e.at,
        recordingStartedAt: null,
        countdown: false,
        stopReason: null,
        error: null,
        result: null,
        alert: null,
      }
    }),
    switchMode: assign(({ event }) => {
      const e = event as Extract<RecordingEvent, { type: 'SWITCH_MODE' }>
      return { feature: e.feature, mode: FEATURE_MODE[e.feature] }
    }),
    markKeyReleased: assign({ keyReleased: true }),
    setWrongKeyAlert: assign({ alert: 'wrong_key' as Alert }),
    setDontHoldAlert: assign({ alert: 'dont_hold' as Alert }),
    markRecordingStarted: assign({ recordingStartedAt: ({ context }) => context.now() }),
    startCountdown: assign({ countdown: true }),
    stopByTimeout: assign({ stopReason: 'timeout' as const }),
    stopByTap: assign(({ event }) => ({
      stopReason: 'tap' as const,
      lastPrimaryDownAt: 'at' in event ? event.at : Number.NEGATIVE_INFINITY,
    })),
    setNoSpeechError: assign({
      error: {
        code: 'RECOVERABLE_NO_SPEECH_DETECTED',
        message: 'Nenhuma fala detectada.',
        recoverable: true,
      } as RecordingError,
    }),
    setInitError: assign({
      error: ({ event }) => toRecordingError((event as { error?: unknown }).error, 'INIT_CHECK_FAILED'),
    }),
    setProcessError: assign({
      error: ({ event }) => toRecordingError((event as { error?: unknown }).error, 'UNKNOWN'),
    }),
    setResult: assign({ result: ({ event }) => (event as unknown as { output: RecordingResult }).output }),
  },
  guards: {
    notDebounced: ({ context, event }) => 'at' in event && event.at - context.lastPrimaryDownAt >= TIMING.DEBOUNCE_MS,
    canStartDictation: ({ context, event }) =>
      event.type === 'PRIMARY_KEY.DOWN' &&
      event.feature === 'dictation' &&
      event.at - context.lastPrimaryDownAt >= TIMING.DEBOUNCE_MS,
    canStartAskAnything: ({ context, event }) =>
      event.type === 'PRIMARY_KEY.DOWN' &&
      event.feature === 'askAnything' &&
      event.at - context.lastPrimaryDownAt >= TIMING.DEBOUNCE_MS,
    canStartTranslation: ({ context, event }) =>
      event.type === 'PRIMARY_KEY.DOWN' &&
      event.feature === 'translation' &&
      event.at - context.lastPrimaryDownAt >= TIMING.DEBOUNCE_MS,
    switchToDictation: ({ event }) => event.type === 'SWITCH_MODE' && event.feature === 'dictation',
    switchToAskAnything: ({ event }) => event.type === 'SWITCH_MODE' && event.feature === 'askAnything',
    switchToTranslation: ({ event }) => event.type === 'SWITCH_MODE' && event.feature === 'translation',
    keyHeld: ({ context }) => !context.keyReleased,
    releasedForTranslation: ({ context }) => context.keyReleased && context.mode === 'translation',
    releasedForHandsFree: ({ context }) => context.keyReleased && context.mode !== 'translation',
    errorNotRecoverable: ({ context }) => context.error?.recoverable !== true,
  },
  delays: {
    // Conta a partir do keydown, não da entrada no estado: trocar de modo durante a
    // inicialização não reinicia os 600 ms.
    LONG_PRESS: ({ context }) => Math.max(0, TIMING.LONG_PRESS_MS - (context.now() - context.keyDownAt)),
    COUNTDOWN_START: TIMING.MAX_DURATION_MS - TIMING.COUNTDOWN_MS,
    MAX_DURATION: TIMING.MAX_DURATION_MS,
    LONG_PRESS_RELEASE_SAFETY: 5000,
    MESSAGE_VISIBLE: 4000,
  },
}).createMachine({
  id: 'recording',
  initial: 'idle',
  context: ({ input }) => ({
    sessionId: null,
    feature: null,
    mode: null,
    keyDownAt: 0,
    keyReleased: true,
    lastPrimaryDownAt: Number.NEGATIVE_INFINITY,
    recordingStartedAt: null,
    countdown: false,
    stopReason: null,
    error: null,
    result: null,
    alert: null,
    now: input?.now ?? (() => Date.now()),
    newSessionId: input?.newSessionId ?? defaultSessionId,
  }),
  states: {
    idle: {
      on: { 'PRIMARY_KEY.DOWN': startTransitions },
    },

    initializingForTapOrHold: initializingState(),
    initializingForHandsFree: initializingState(),
    initializingForTranslation: initializingState(),

    awaiting_long_press_or_tap: {
      always: [
        { guard: 'releasedForTranslation', target: 'recording_active.translationModeHandsFree' },
        { guard: 'releasedForHandsFree', target: 'recording_active.handsFree' },
      ],
      after: { LONG_PRESS: { target: 'long_pressing' } },
      on: {
        'PRIMARY_KEY.UP': { actions: 'markKeyReleased' },
        SWITCH_MODE: { actions: 'switchMode' },
        'WRONG_KEY.DOWN': { target: 'stopping', actions: 'setWrongKeyAlert' },
        CANCEL: { target: 'stopping' },
      },
    },

    // Segurou 600 ms: descarta e avisa "não segure, toque uma vez". Espera soltar.
    long_pressing: {
      entry: ['releaseRecording', 'setDontHoldAlert'],
      after: { LONG_PRESS_RELEASE_SAFETY: { target: 'stopping' } },
      on: {
        'PRIMARY_KEY.UP': { target: 'stopping', actions: 'markKeyReleased' },
      },
    },

    recording_active: {
      initial: 'handsFree',
      entry: ['markRecordingStarted', 'onRecordingActive'],
      exit: 'onRecordingInactive',
      after: {
        COUNTDOWN_START: { actions: 'startCountdown' },
        // RECORD.TIMEOUT
        MAX_DURATION: { target: 'finishing', actions: 'stopByTimeout' },
      },
      on: {
        'PRIMARY_KEY.DOWN': { guard: 'notDebounced', target: 'finishing', actions: 'stopByTap' },
        CANCEL: { target: 'stopping' },
        NO_SPEECH: { target: 'error', actions: 'setNoSpeechError' },
      },
      states: {
        handsFree: {},
        translationModeHandsFree: {},
      },
    },

    finishing: {
      invoke: {
        src: 'finishRecording',
        input: ({ context }) => ({
          sessionId: context.sessionId ?? '',
          mode: context.mode ?? 'transcript',
          reason: context.stopReason,
        }),
        onDone: {
          target: 'idle',
          actions: ['setResult', { type: 'insertResult', params: ({ event }) => ({ result: event.output }) }],
        },
        onError: { target: 'error', actions: 'setProcessError' },
      },
    },

    // Descarta sem processar (Esc, tecla errada, segurar).
    stopping: {
      invoke: {
        src: 'discardRecording',
        input: ({ context }) => ({ sessionId: context.sessionId }),
        onDone: { target: 'idle' },
        onError: { target: 'idle' },
      },
    },

    // Erro recuperável: mostra a mensagem, permite refazer. Os outros vão para `failure`.
    error: {
      entry: 'releaseRecording',
      always: { guard: 'errorNotRecoverable', target: 'failure' },
      after: { MESSAGE_VISIBLE: { target: 'idle' } },
      on: {
        RETRY: { target: 'retrying' },
        DISMISS: { target: 'idle' },
        'PRIMARY_KEY.DOWN': startTransitions,
      },
    },

    retrying: {
      invoke: {
        src: 'retryRecording',
        input: checksInput,
        onDone: {
          target: 'idle',
          actions: ['setResult', { type: 'insertResult', params: ({ event }) => ({ result: event.output }) }],
        },
        onError: { target: 'failure', actions: 'setProcessError' },
      },
    },

    failure: {
      entry: 'releaseRecording',
      after: { MESSAGE_VISIBLE: { target: 'idle' } },
      on: {
        DISMISS: { target: 'idle' },
        'PRIMARY_KEY.DOWN': startTransitions,
      },
    },
  },
})

/** Nome do estado em texto, ex. `recording_active.handsFree`. */
export function stateName(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const [key, child] = Object.entries(value as Record<string, unknown>)[0] ?? []
    return key ? `${key}.${stateName(child)}` : ''
  }
  return ''
}

export function isRecordingActive(state: string): boolean {
  return state.startsWith('recording_active')
}
