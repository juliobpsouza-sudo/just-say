// Aprendizado por edição, a parte do servidor (`POST /user/traits`):
// o app manda o texto colado e como ele ficou depois que a pessoa corrigiu; aqui se decide
// quais palavras novas entram no dicionário. Regras próprias (D64). Testado em tests/traits.test.ts.

export interface Replacement {
  from: string
  to: string
  /** A palavra nova abre uma frase (maiúscula de começo de frase não conta como nome). */
  sentenceStart: boolean
}

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}.+#'’_-]*[\p{L}\p{N}+#]|[\p{L}\p{N}]/gu

interface Tok {
  text: string
  start: number
}

function tokenize(s: string): Tok[] {
  return [...s.matchAll(TOKEN)].map((m) => ({ text: m[0], start: m.index ?? 0 }))
}

function isSentenceStart(s: string, start: number): boolean {
  const before = s.slice(0, start).trimEnd()
  return before === '' || /[.!?…:\n]$/.test(before)
}

/** Trocas de 1 a 3 palavras por 1 a 3 palavras, por alinhamento de palavras (LCS). */
export function wordReplacements(before: string, after: string): Replacement[] {
  const a = tokenize(before)
  const b = tokenize(after)
  if (a.length > 600 || b.length > 600) return []
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i].text === b[j].text ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])

  const out: Replacement[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i].text === b[j].text) {
      i++
      j++
      continue
    }
    const i0 = i
    const j0 = j
    while ((i < n || j < m) && !(i < n && j < m && a[i].text === b[j].text)) {
      if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) j++
      else i++
    }
    const removed = a.slice(i0, i)
    const added = b.slice(j0, j)
    if (removed.length >= 1 && removed.length <= 3 && added.length >= 1 && added.length <= 3)
      out.push({
        from: removed.map((t) => t.text).join(' '),
        to: added.map((t) => t.text).join(' '),
        sentenceStart: isSentenceStart(after, added[0].start),
      })
  }
  return out
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

export function similarity(a: string, b: string): number {
  const x = Array.from(fold(a))
  const y = Array.from(fold(b))
  if (!x.length && !y.length) return 1
  let prev = Array.from({ length: y.length + 1 }, (_, k) => k)
  for (let i = 1; i <= x.length; i++) {
    const cur = [i]
    for (let k = 1; k <= y.length; k++)
      cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (x[i - 1] === y[k - 1] ? 0 : 1))
    prev = cur
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length)
}

/** Parece nome próprio ou termo técnico: tem maiúscula, número ou símbolo de termo (Next.js, C++). */
function looksLikeTerm(word: string): boolean {
  return /\p{Lu}/u.test(word) || /\p{N}/u.test(word) || /[.+#_]/.test(word)
}

/**
 * Restos de edição que não são termo (D87): duas palavras coladas por um ponto sem espaço
 * ("nomes.Dr"), sigla grudada numa palavra ("TIsetor") ou pontuação de frase na ponta
 * ou no meio ("ok,", "fim.").
 */
function isJunkTerm(term: string): boolean {
  return (
    /\p{Ll}{2,}\.\p{Lu}/u.test(term) ||
    /\p{Lu}{2,}\p{Ll}{4,}/u.test(term) ||
    /^[^\p{L}\p{N}]|[,;:!?]|\.$/u.test(term)
  )
}

/**
 * Quais trocas viram termo do dicionário. Precisa ser:
 *  - uma correção de reconhecimento (parecida com o que saiu: "Marcus" → "Marcos"), não uma
 *    troca de palavra ("sexta" → "segunda");
 *  - um nome próprio ou termo técnico (maiúscula fora do começo da frase, número ou símbolo);
 *  - de 3 a 50 letras, sem cara de resto de edição (`isJunkTerm`), e ainda fora do dicionário.
 */
export function termsFromEdit(before: string, after: string, known: readonly string[], max = 2): string[] {
  const knownSet = new Set(known.map(fold))
  const out: string[] = []
  for (const r of wordReplacements(before, after)) {
    const term = r.to.trim()
    const len = Array.from(term).length
    if (len < 3 || len > 50 || isJunkTerm(term)) continue
    if (knownSet.has(fold(term)) || out.some((t) => fold(t) === fold(term))) continue
    // Só mudou maiúscula/acento ("marcos" → "Marcos")? Conta, menos no começo de frase.
    const sameLetters = fold(r.from) === fold(term)
    if (sameLetters) {
      if (r.sentenceStart || r.from === term || !/\p{Lu}/u.test(term)) continue
    } else {
      if (similarity(r.from, term) < 0.5) continue
      if (!looksLikeTerm(term)) continue
      // Maiúscula só na primeira letra, abrindo a frase: provavelmente palavra comum.
      if (r.sentenceStart && !/\p{N}|[.+#_]/u.test(term) && !/\p{Lu}/u.test(term.slice(1))) continue
    }
    out.push(term)
    if (out.length >= max) break
  }
  return out
}
