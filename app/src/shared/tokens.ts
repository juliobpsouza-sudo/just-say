// Estimador de tokens e cortes de texto (textos longos
// são cortados pelo meio). Não precisa ser exato: serve para respeitar os limites
// (10 mil tokens de texto visível, 1.000 + 1.000 de texto relacionado).

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/g

/** ~4 caracteres por token em línguas latinas; 1 token por ideograma (chinês, japonês, coreano). */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = text.match(CJK)?.length ?? 0
  return cjk + Math.ceil((text.length - cjk) / 4)
}

/** Quantos caracteres de `text` cabem em `maxTokens`, mantendo a proporção do texto. */
function charsFor(text: string, maxTokens: number): number {
  const tokens = estimateTokens(text)
  if (tokens <= maxTokens) return text.length
  return Math.max(0, Math.floor((text.length * maxTokens) / tokens))
}

export const MIDDLE_MARKER = '\n[…]\n'

/** Corta pelo meio: mantém o começo e o fim (onde costuma estar o que importa). */
export function truncateMiddle(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text
  const keep = charsFor(text, maxTokens) - MIDDLE_MARKER.length
  if (keep <= 0) return ''
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return text.slice(0, head) + MIDDLE_MARKER + (tail > 0 ? text.slice(text.length - tail) : '')
}

/** Mantém o fim (texto antes do cursor: o que está mais perto dele). */
export function keepTail(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text
  const keep = charsFor(text, maxTokens)
  return keep > 0 ? text.slice(text.length - keep) : ''
}

/** Mantém o começo (texto depois do cursor). */
export function keepHead(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text
  return text.slice(0, charsFor(text, maxTokens))
}

/** Limpa o texto lido da tela: tira o caractere de objeto (U+FFFC) e excesso de linhas vazias. */
export function cleanScreenText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(/￼/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
