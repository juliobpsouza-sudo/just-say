import { describe, expect, it } from 'vitest'
import {
  detectShortcut,
  INITIAL_DETECTOR,
  type DetectorConfig,
  type DetectorEvent,
  type DetectorState,
} from '../src/renderer/src/recording/shortcutDetector'
import { DEFAULT_SHORTCUTS } from '../src/shared/shortcuts'

const config: DetectorConfig = { bindings: DEFAULT_SHORTCUTS, cancelEnabled: false }

/** Aplica uma sequência de conjuntos de teclas e devolve todos os eventos. */
function run(steps: string[][], cfg: DetectorConfig = config) {
  let state: DetectorState = INITIAL_DETECTOR
  const events: DetectorEvent[] = []
  steps.forEach((pressed, i) => {
    const r = detectShortcut(state, pressed, i * 10, cfg)
    state = r.state
    events.push(...r.events)
  })
  return { state, types: events.map((e) => ('feature' in e ? `${e.type}:${e.feature}` : e.type)), events }
}

describe('detector de atalho', () => {
  it('toque no RightAlt gera DOWN e UP do ditado', () => {
    expect(run([['RightAlt'], []]).types).toEqual(['PRIMARY_KEY.DOWN:dictation', 'PRIMARY_KEY.UP:dictation'])
  })

  it('RightAlt e depois Space vira Ask Anything', () => {
    expect(run([['RightAlt'], ['RightAlt', 'Space'], ['RightAlt'], []]).types).toEqual([
      'PRIMARY_KEY.DOWN:dictation',
      'SWITCH_MODE:askAnything',
      'PRIMARY_KEY.UP:askAnything',
    ])
  })

  it('RightAlt e depois RightShift vira tradução', () => {
    expect(run([['RightAlt'], ['RightAlt', 'RightShift'], []]).types).toEqual([
      'PRIMARY_KEY.DOWN:dictation',
      'SWITCH_MODE:translation',
      'PRIMARY_KEY.UP:translation',
    ])
  })

  it('retratos juntados pelo throttle ainda casam o atalho maior', () => {
    expect(run([['RightAlt', 'Space'], []]).types).toEqual([
      'PRIMARY_KEY.DOWN:askAnything',
      'PRIMARY_KEY.UP:askAnything',
    ])
  })

  it('outra tecla enquanto segura o atalho gera WRONG_KEY.DOWN', () => {
    const r = run([['RightAlt'], ['RightAlt', 'Q']])
    expect(r.types).toEqual(['PRIMARY_KEY.DOWN:dictation', 'WRONG_KEY.DOWN'])
    expect(r.events[1]).toMatchObject({ key: 'Q' })
  })

  it('não dispara se já havia outra tecla segurada (combinação não exata)', () => {
    expect(run([['LeftShift'], ['LeftShift', 'RightAlt'], ['LeftShift'], []]).types).toEqual([])
  })

  it('reenvio do mesmo retrato (resync de 50 ms) não gera eventos', () => {
    expect(run([['RightAlt'], ['RightAlt'], ['RightAlt'], []]).types).toEqual([
      'PRIMARY_KEY.DOWN:dictation',
      'PRIMARY_KEY.UP:dictation',
    ])
  })

  it('Escape só cancela quando o cancelar está registrado', () => {
    expect(run([['Escape'], []]).types).toEqual([])
    expect(run([['Escape'], []], { ...config, cancelEnabled: true }).types).toEqual(['CANCEL'])
  })

  it('LeftCtrl+RightShift+V cola a última transcrição', () => {
    expect(run([['LeftCtrl'], ['LeftCtrl', 'RightShift'], ['LeftCtrl', 'RightShift', 'V'], []]).types).toEqual([
      'PASTE_LAST',
    ])
  })

  it('respeita atalhos personalizados', () => {
    const custom: DetectorConfig = {
      bindings: { ...DEFAULT_SHORTCUTS, dictation: ['F13'], askAnything: ['F13', 'Space'] },
      cancelEnabled: false,
    }
    expect(run([['RightAlt'], []], custom).types).toEqual([])
    expect(run([['F13'], []], custom).types).toEqual(['PRIMARY_KEY.DOWN:dictation', 'PRIMARY_KEY.UP:dictation'])
  })
})
