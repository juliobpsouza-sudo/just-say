// Espaço antes do texto colado: se o cursor está colado numa palavra ("Olá|"), o texto ditado
// precisa de um espaço na frente para não grudar ("Olá mundo" e não "Olámundo").
// Decisão nossa, feita no cliente porque os modelos não lidam bem com espaço no começo (D47).

const NO_SPACE_AFTER = /[\s([{"'“‘«\-/@#]$/
const STARTS_WITH_WORD = /^[\p{L}\p{N}"“'‘(]/u

export function spaceBeforeInsert(textBefore: string | null | undefined, text: string): string {
  if (!textBefore || !text) return text
  if (NO_SPACE_AFTER.test(textBefore)) return text
  if (!STARTS_WITH_WORD.test(text)) return text
  return ` ${text}`
}
