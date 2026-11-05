// Recorte do contexto da tela para o modelo de refino.
// O app captura até 10 mil tokens de texto visível, mas os modelos
// gratuitos do Groq aceitam ~8 mil tokens por MINUTO. Então só um recorte vai ao modelo.
// Ver DECISOES D48.

export const CONTEXT_BUDGET = {
  visibleTokens: 1000,
  fieldBeforeTokens: 400,
  fieldAfterTokens: 150,
  pageBeforeTokens: 300,
  pageAfterTokens: 150,
} as const

export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = text.match(/[぀-ヿ㐀-䶿一-鿿가-힯]/g)?.length ?? 0
  return cjk + Math.ceil((text.length - cjk) / 4)
}

function charsFor(text: string, maxTokens: number): number {
  const tokens = estimateTokens(text)
  return tokens <= maxTokens ? text.length : Math.max(0, Math.floor((text.length * maxTokens) / tokens))
}

export function truncateMiddle(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text
  const marker = '\n[…]\n'
  const keep = charsFor(text, maxTokens) - marker.length
  if (keep <= 0) return ''
  const head = Math.ceil(keep / 2)
  return text.slice(0, head) + marker + text.slice(text.length - (keep - head))
}

export function keepTail(text: string, maxTokens: number): string {
  const keep = charsFor(text, maxTokens)
  return keep >= text.length ? text : text.slice(text.length - keep)
}

export function keepHead(text: string, maxTokens: number): string {
  return text.slice(0, charsFor(text, maxTokens))
}
