// Links que o app aceita abrir no navegador (Ask Anything "abrir" e fontes do cartão).

/** Só http/https, sem usuário e senha. Devolve a URL normalizada ou null. */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password || !url.hostname) return null
  return url.toString()
}

/** "https://www.youtube.com/watch?v=1" → "youtube.com". */
export function displayDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
