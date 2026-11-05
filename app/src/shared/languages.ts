// Idiomas de destino do modo Tradução. Os códigos são os mesmos do servidor
// (server/src/refine/languages.ts).
import { LIMITS } from './constants'

export interface TranslationLanguage {
  code: string
  label: string
}

export const TRANSLATION_LANGUAGES: readonly TranslationLanguage[] = [
  { code: 'en', label: 'Inglês' },
  { code: 'en-US', label: 'Inglês americano' },
  { code: 'en-GB', label: 'Inglês britânico' },
  { code: 'es', label: 'Espanhol' },
  { code: 'pt-BR', label: 'Português do Brasil' },
  { code: 'pt-PT', label: 'Português de Portugal' },
  { code: 'fr', label: 'Francês' },
  { code: 'de', label: 'Alemão' },
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Holandês' },
  { code: 'pl', label: 'Polonês' },
  { code: 'ru', label: 'Russo' },
  { code: 'uk', label: 'Ucraniano' },
  { code: 'tr', label: 'Turco' },
  { code: 'ar', label: 'Árabe' },
  { code: 'he', label: 'Hebraico' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ja', label: 'Japonês' },
  { code: 'ko', label: 'Coreano' },
  { code: 'zh', label: 'Chinês simplificado' },
  { code: 'zh-TW', label: 'Chinês tradicional' },
  { code: 'id', label: 'Indonésio' },
  { code: 'vi', label: 'Vietnamita' },
  { code: 'sv', label: 'Sueco' },
]

/** Lista que vem com o app: começa com o inglês (D58). */
export const DEFAULT_TRANSLATION_TARGETS = ['en']

export function languageLabel(code: string | null | undefined): string {
  return TRANSLATION_LANGUAGES.find((l) => l.code === code)?.label ?? code ?? ''
}

export function isKnownLanguage(code: unknown): code is string {
  return typeof code === 'string' && TRANSLATION_LANGUAGES.some((l) => l.code === code)
}

/** Lista válida: só códigos conhecidos, sem repetir, no máximo 3. */
export function isValidTargetList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= LIMITS.TRANSLATION_TARGET_LANGUAGES_MAX &&
    value.every(isKnownLanguage) &&
    new Set(value).size === value.length
  )
}

/** Idioma ativo: o escolhido, se ainda está na lista; senão o primeiro; lista vazia = null. */
export function activeTargetLanguage(targets: readonly string[], preferred: string | null): string | null {
  if (preferred && targets.includes(preferred)) return preferred
  return targets[0] ?? null
}

/** Próximo idioma da lista (clique na barra durante a gravação). */
export function nextTargetLanguage(targets: readonly string[], current: string | null): string | null {
  if (targets.length === 0) return null
  const i = current ? targets.indexOf(current) : -1
  return targets[(i + 1) % targets.length]
}

// ---------- idiomas do ditado ----------

/** Idiomas em que a pessoa fala. Com um só, o STT fixa o idioma e erra menos. */
export const DICTATION_LANGUAGES: readonly TranslationLanguage[] = [
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'pt-PT', label: 'Português (Portugal)' },
  { code: 'en', label: 'Inglês' },
  { code: 'es', label: 'Espanhol' },
  { code: 'fr', label: 'Francês' },
  { code: 'de', label: 'Alemão' },
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Holandês' },
  { code: 'pl', label: 'Polonês' },
  { code: 'ru', label: 'Russo' },
  { code: 'uk', label: 'Ucraniano' },
  { code: 'tr', label: 'Turco' },
  { code: 'ar', label: 'Árabe' },
  { code: 'he', label: 'Hebraico' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ja', label: 'Japonês' },
  { code: 'ko', label: 'Coreano' },
  { code: 'zh', label: 'Chinês' },
  { code: 'id', label: 'Indonésio' },
  { code: 'vi', label: 'Vietnamita' },
  { code: 'sv', label: 'Sueco' },
]

export const DICTATION_LANGUAGES_MAX = 5

export function isValidDictationLanguages(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= DICTATION_LANGUAGES_MAX &&
    value.every((c) => DICTATION_LANGUAGES.some((l) => l.code === c)) &&
    new Set(value).size === value.length
  )
}

/** `parameters.languages` do pedido: vazio = detecção automática. */
export function dictationLanguagesParam(auto: boolean, selected: readonly string[]): string[] {
  return auto ? [] : [...selected]
}
