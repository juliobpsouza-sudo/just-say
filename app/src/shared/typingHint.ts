// Dica de uso: mais de 60 teclas digitadas em 60 s num campo
// editável → sugerir o ditado. Só conta; nunca guarda quais teclas foram.
import { LIMITS, TIMING } from './constants'

const PUNCTUATION = new Set([
  'Space',
  'Backspace',
  'Comma',
  'Period',
  'Semicolon',
  'Slash',
  'Quote',
  'Minus',
  'Equal',
  'Backquote',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'IntlBackslash',
  'AbntC1',
  'AbntC2',
])

const COMMAND_MODIFIERS = ['LeftCtrl', 'RightCtrl', 'LeftAlt', 'LeftWin', 'RightWin']

/** Tecla de escrever texto? Letras, números, espaço e pontuação, sem Ctrl/Alt/Win segurado. */
export function isTypingKey(key: string, pressing: readonly string[]): boolean {
  if (pressing.some((k) => COMMAND_MODIFIERS.includes(k))) return false
  return /^[A-Z]$/.test(key) || /^Digit\d$/.test(key) || /^Numpad\d$/.test(key) || PUNCTUATION.has(key)
}

/** Janela deslizante de 60 s com os horários das teclas. */
export class TypingCounter {
  private times: number[] = []

  constructor(
    private readonly windowMs = TIMING.TYPING_HINT_WINDOW_MS,
    private readonly threshold = LIMITS.TYPING_HINT_KEYS,
  ) {}

  /** Conta uma tecla. Devolve true quando passa do limite (e zera, para não repetir). */
  push(at: number): boolean {
    this.times.push(at)
    while (this.times.length && this.times[0] <= at - this.windowMs) this.times.shift()
    if (this.times.length > this.threshold) {
      this.times = []
      return true
    }
    return false
  }

  reset(): void {
    this.times = []
  }
}

/** No máximo uma dica por dia. */
export const TYPING_HINT_COOLDOWN_MS = 24 * 3_600_000

export function canShowTypingHint(enabled: boolean, lastShownAt: number | null, now: number): boolean {
  return enabled && (lastShownAt === null || now - lastShownAt >= TYPING_HINT_COOLDOWN_MS)
}
