// Idiomas de destino da tradução. Os códigos são os mesmos da tela do app
// (app/src/shared/languages.ts).

const NAMES: Record<string, string> = {
  en: 'inglês',
  'en-US': 'inglês americano',
  'en-GB': 'inglês britânico',
  es: 'espanhol',
  pt: 'português',
  'pt-BR': 'português do Brasil',
  'pt-PT': 'português de Portugal',
  fr: 'francês',
  de: 'alemão',
  it: 'italiano',
  nl: 'holandês',
  pl: 'polonês',
  ru: 'russo',
  uk: 'ucraniano',
  tr: 'turco',
  ar: 'árabe',
  he: 'hebraico',
  hi: 'hindi',
  ja: 'japonês',
  ko: 'coreano',
  zh: 'chinês simplificado',
  'zh-TW': 'chinês tradicional',
  id: 'indonésio',
  vi: 'vietnamita',
  sv: 'sueco',
}

/** Nome em português para o prompt; código desconhecido = null. */
export function languageName(code: unknown): string | null {
  return typeof code === 'string' && Object.hasOwn(NAMES, code) ? NAMES[code] : null
}
