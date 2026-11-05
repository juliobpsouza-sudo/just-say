// Chamadas assíncronas ao koffi (rodam numa thread do pool do koffi, fora do event loop).
type KoffiFunction = { async: (...args: unknown[]) => void }

const DEFAULT_OUT_BYTES = 256 * 1024

export function callAsync<T>(fn: unknown, ...args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    ;(fn as KoffiFunction).async(...args, (err: unknown, value: T) => (err ? reject(err) : resolve(value)))
  })
}

/**
 * Chama uma função nativa no formato `int fn(..., char *out, int capacity)`, que escreve
 * UTF-8 em `out` e devolve o tamanho (ou um código negativo).
 */
export async function callWithOut(fn: unknown, args: unknown[], bytes = DEFAULT_OUT_BYTES): Promise<string> {
  const out = Buffer.alloc(bytes)
  const n = await callAsync<number>(fn, ...args, out, out.length)
  if (n < 0) throw new NativeError(n)
  return out.toString('utf8', 0, Math.min(n, out.length - 1))
}

export class NativeError extends Error {
  constructor(readonly code: number) {
    super(`função nativa devolveu ${code}`)
  }
}
