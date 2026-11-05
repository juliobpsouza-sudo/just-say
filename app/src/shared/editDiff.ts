// Aprendizado por edição, a parte do cliente: achar o trecho colado
// no campo, comparar letra a letra com o que ficou e descartar mudanças grandes.
// Escrito aqui (sem biblioteca de diff): só as contagens importam. Testado em tests/editDiff.test.ts.
import { LIMITS } from './constants'

export interface DiffCounts {
  /** Letras que saíram do texto colado. */
  removed: number
  /** Letras que entraram. */
  added: number
}

/**
 * Contagem de letras removidas e adicionadas de `a` para `b` (diff de Myers, O((N+M)·D)).
 * Para cedo se a distância passar de `maxD`: aí devolve null (mudança grande demais).
 */
export function diffCounts(a: string, b: string, maxD = Number.POSITIVE_INFINITY): DiffCounts | null {
  const x = Array.from(a)
  const y = Array.from(b)
  const n = x.length
  const m = y.length
  const max = Math.min(n + m, maxD)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let j = i - k
      while (i < n && j < m && x[i] === y[j]) {
        i++
        j++
      }
      v[offset + k] = i
      if (i >= n && j >= m) {
        // d = removidas + adicionadas; o que sobra é comum aos dois.
        const common = (n + m - d) / 2
        return { removed: n - common, added: m - common }
      }
    }
  }
  return null
}

export type EditVerdict =
  | { kind: 'none' }
  | { kind: 'small'; removed: number; added: number }
  | { kind: 'too_big'; reason: 'removed' | 'changed' | 'shrunk' }

/**
 * Decide se a edição conta como correção: descarta se mais de 50% do texto
 * colado saiu, se a mudança passou de 2× o tamanho dele ou se o trecho ficou com menos de 20%.
 */
export function editVerdict(before: string, after: string): EditVerdict {
  if (before === after) return { kind: 'none' }
  const len = Array.from(before).length
  if (len === 0) return { kind: 'too_big', reason: 'changed' }
  if (Array.from(after).length < LIMITS.EDIT_MIN_FINAL_RATIO * len) return { kind: 'too_big', reason: 'shrunk' }
  const counts = diffCounts(before, after, Math.ceil(LIMITS.EDIT_MAX_CHANGED_RATIO * len))
  if (!counts) return { kind: 'too_big', reason: 'changed' }
  if (counts.removed > LIMITS.EDIT_MAX_REMOVED_RATIO * len) return { kind: 'too_big', reason: 'removed' }
  if (counts.removed + counts.added > LIMITS.EDIT_MAX_CHANGED_RATIO * len) return { kind: 'too_big', reason: 'changed' }
  return { kind: 'small', ...counts }
}

/**
 * Onde o texto colado está agora. `baseline` é o campo logo depois de colar; `current`, o
 * campo agora. Só vale se o que estava antes e depois do trecho colado continua igual
 * (a pessoa mexeu só no que o app escreveu). Devolve o trecho colado (sem os espaços das
 * pontas) e como ele está agora, ou null.
 */
export function locateEdited(baseline: string, inserted: string, current: string): { before: string; after: string } | null {
  const needle = inserted.trim()
  if (!needle) return null
  const i = baseline.lastIndexOf(needle)
  if (i < 0) return null
  const prefix = baseline.slice(0, i)
  const suffix = baseline.slice(i + needle.length)
  if (current.length < prefix.length + suffix.length) return null
  if (!current.startsWith(prefix) || !current.endsWith(suffix)) return null
  return { before: needle, after: current.slice(prefix.length, current.length - suffix.length) }
}
