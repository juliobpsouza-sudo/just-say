// Detector de atalho: transforma o conjunto de teclas pressionadas em eventos da máquina.
// Função pura (reducer), testada em tests/shortcutDetector.test.ts.
//
// Trabalha só com o conjunto atual, não com eventos individuais, porque o main faz
// throttle de 16 ms e pode juntar dois retratos num só.
import {
  RECORDING_FEATURES,
  sameCombo,
  type RecordingFeature,
  type ShortcutBindings,
} from '../../../shared/shortcuts'

export type DetectorEvent =
  | { type: 'PRIMARY_KEY.DOWN'; feature: RecordingFeature; at: number }
  | { type: 'PRIMARY_KEY.UP'; feature: RecordingFeature; at: number }
  | { type: 'SWITCH_MODE'; feature: RecordingFeature; at: number }
  | { type: 'WRONG_KEY.DOWN'; key: string; at: number }
  | { type: 'CANCEL'; at: number }
  | { type: 'PASTE_LAST'; at: number }

export interface DetectorState {
  pressed: string[]
  /** Atalho de gravação que está sendo segurado agora. */
  active: { feature: RecordingFeature; keys: string[] } | null
}

export const INITIAL_DETECTOR: DetectorState = { pressed: [], active: null }

export interface DetectorConfig {
  bindings: ShortcutBindings
  /** O Escape só é registrado enquanto grava. */
  cancelEnabled: boolean
}

function recordingFeatureFor(keys: readonly string[], bindings: ShortcutBindings): RecordingFeature | null {
  for (const feature of RECORDING_FEATURES) {
    if (sameCombo(bindings[feature], keys)) return feature
  }
  return null
}

export function detectShortcut(
  state: DetectorState,
  pressedNow: readonly string[],
  at: number,
  config: DetectorConfig,
): { state: DetectorState; events: DetectorEvent[] } {
  const prev = new Set(state.pressed)
  const now = new Set(pressedNow)
  const added = pressedNow.filter((k) => !prev.has(k))
  const pressed = [...pressedNow]
  const events: DetectorEvent[] = []

  if (state.active) {
    const active = state.active
    const releasedActiveKey = active.keys.some((k) => !now.has(k))
    if (releasedActiveKey) {
      events.push({ type: 'PRIMARY_KEY.UP', feature: active.feature, at })
      return { state: { pressed, active: null }, events }
    }
    if (added.length > 0) {
      // Segurando o atalho e completando outro atalho maior (ex.: RightAlt → RightAlt+Space).
      const upgraded = recordingFeatureFor(pressedNow, config.bindings)
      if (upgraded && upgraded !== active.feature) {
        events.push({ type: 'SWITCH_MODE', feature: upgraded, at })
        return { state: { pressed, active: { feature: upgraded, keys: [...pressedNow] } }, events }
      }
      events.push({ type: 'WRONG_KEY.DOWN', key: added[0], at })
    }
    return { state: { pressed, active }, events }
  }

  if (added.length === 0) return { state: { pressed, active: null }, events }

  if (config.cancelEnabled && sameCombo(config.bindings.cancel, pressedNow)) {
    events.push({ type: 'CANCEL', at })
    return { state: { pressed, active: null }, events }
  }
  if (sameCombo(config.bindings.pasteLastTranscript, pressedNow)) {
    events.push({ type: 'PASTE_LAST', at })
    return { state: { pressed, active: null }, events }
  }
  const feature = recordingFeatureFor(pressedNow, config.bindings)
  if (feature) {
    events.push({ type: 'PRIMARY_KEY.DOWN', feature, at })
    return { state: { pressed, active: { feature, keys: [...pressedNow] } }, events }
  }
  return { state: { pressed, active: null }, events }
}
