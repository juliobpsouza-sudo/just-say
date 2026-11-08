// Atalhos: nomes de tecla, padrões do Windows, rótulos e validação.
// Os nomes de tecla são os mesmos que o KeyboardHelper.dll devolve.

export type ShortcutFeature = 'dictation' | 'askAnything' | 'translation' | 'pasteLastTranscript' | 'cancel'

export type ShortcutBindings = Record<ShortcutFeature, string[]>

export type RecordingFeature = 'dictation' | 'askAnything' | 'translation'

export const RECORDING_FEATURES: readonly RecordingFeature[] = ['dictation', 'askAnything', 'translation']

export const SHORTCUT_FEATURES: readonly ShortcutFeature[] = [
  'dictation',
  'askAnything',
  'translation',
  'pasteLastTranscript',
  'cancel',
]

export const DEFAULT_SHORTCUTS: ShortcutBindings = {
  dictation: ['RightAlt'],
  askAnything: ['RightAlt', 'Space'],
  translation: ['RightAlt', 'RightShift'],
  pasteLastTranscript: ['LeftCtrl', 'RightShift', 'V'],
  cancel: ['Escape'],
}

export const FEATURE_LABELS: Record<ShortcutFeature, { title: string; hint: string }> = {
  dictation: { title: 'Ditado', hint: 'Toque para começar a falar e toque de novo para inserir o texto.' },
  askAnything: { title: 'Just Ask', hint: 'Toque, faça uma pergunta ou peça uma edição do texto selecionado.' },
  translation: { title: 'Tradução', hint: 'Toque, fale num idioma e receba o texto traduzido.' },
  pasteLastTranscript: { title: 'Colar a última transcrição', hint: 'Insere de novo o último texto.' },
  cancel: { title: 'Cancelar', hint: 'Só funciona enquanto grava. Descarta a gravação.' },
}

const MODIFIER_ORDER = ['LeftCtrl', 'RightCtrl', 'LeftWin', 'RightWin', 'LeftAlt', 'RightAlt', 'LeftShift', 'RightShift']

export function isModifier(key: string): boolean {
  return MODIFIER_ORDER.includes(key)
}

const KEY_LABELS: Record<string, string> = {
  LeftCtrl: 'Ctrl esquerdo',
  RightCtrl: 'Ctrl direito',
  LeftShift: 'Shift esquerdo',
  RightShift: 'Shift direito',
  LeftAlt: 'Alt esquerdo',
  RightAlt: 'Alt direito (AltGr)',
  LeftWin: 'Win esquerdo',
  RightWin: 'Win direito',
  Space: 'Espaço',
  Enter: 'Enter',
  NumpadEnter: 'Enter (numérico)',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: 'Backspace',
  CapsLock: 'Caps Lock',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PrintScreen: 'Print Screen',
  ScrollLock: 'Scroll Lock',
  Pause: 'Pause',
  NumLock: 'Num Lock',
  ContextMenu: 'Menu',
  MouseMiddle: 'Botão do meio do mouse',
  MouseX1: 'Botão lateral 1 do mouse',
  MouseX2: 'Botão lateral 2 do mouse',
}

export function keyLabel(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key]
  if (/^Digit\d$/.test(key)) return key.slice(5)
  if (/^Numpad\d$/.test(key)) return `${key.slice(6)} (numérico)`
  return key
}

/** Ordena modificadores primeiro, na ordem Ctrl, Win, Alt, Shift. */
export function normalizeCombo(keys: readonly string[]): string[] {
  const unique = [...new Set(keys)]
  const mods = MODIFIER_ORDER.filter((m) => unique.includes(m))
  const rest = unique.filter((k) => !isModifier(k))
  return [...mods, ...rest]
}

export function comboLabel(keys: readonly string[]): string {
  return normalizeCombo(keys).map(keyLabel).join(' + ')
}

export function sameCombo(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((k) => set.has(k))
}

/** Erros de configuração, em português. Lista vazia = válido. */
export function validateBindings(bindings: ShortcutBindings): string[] {
  const errors: string[] = []
  for (const feature of SHORTCUT_FEATURES) {
    const keys = bindings[feature]
    if (!keys || keys.length === 0) errors.push(`${FEATURE_LABELS[feature].title}: o atalho está vazio.`)
  }
  for (let i = 0; i < SHORTCUT_FEATURES.length; i++) {
    for (let j = i + 1; j < SHORTCUT_FEATURES.length; j++) {
      const a = SHORTCUT_FEATURES[i]
      const b = SHORTCUT_FEATURES[j]
      // O cancelar só vale durante a gravação, mas não pode colidir com o que encerra a gravação.
      if (bindings[a]?.length && sameCombo(bindings[a], bindings[b] ?? [])) {
        errors.push(`${FEATURE_LABELS[a].title} e ${FEATURE_LABELS[b].title} usam o mesmo atalho.`)
      }
    }
  }
  return errors
}

/** Lista de combinações que o hook deve reconhecer (e engolir a tecla não modificadora). */
export function targetShortcutList(bindings: ShortcutBindings, includeCancel: boolean): string[][] {
  const features = SHORTCUT_FEATURES.filter((f) => f !== 'cancel' || includeCancel)
  return features.map((f) => normalizeCombo(bindings[f])).filter((k) => k.length > 0)
}

// ---------- captura de um atalho novo na tela de configurações ----------

export interface CaptureState {
  /** Maior conjunto de teclas pressionadas ao mesmo tempo nesta captura. */
  peak: string[]
  /** Combinação final, quando todas as teclas foram soltas. */
  result: string[] | null
}

export const EMPTY_CAPTURE: CaptureState = { peak: [], result: null }

/** Recebe o conjunto atual de teclas pressionadas. Quando tudo é solto, fecha a combinação. */
export function captureReducer(state: CaptureState, pressing: readonly string[]): CaptureState {
  if (state.result) return state
  if (pressing.length === 0) {
    return state.peak.length > 0 ? { peak: state.peak, result: normalizeCombo(state.peak) } : state
  }
  const merged = normalizeCombo([...state.peak, ...pressing])
  return merged.length > state.peak.length ? { peak: merged, result: null } : state
}
