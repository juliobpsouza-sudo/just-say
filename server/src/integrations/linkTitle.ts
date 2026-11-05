// Título de um link selecionado (D73): para anotar um vídeo ou página que a pessoa não abriu,
// só selecionou (ex.: um link no WhatsApp). YouTube pelo oEmbed público (sem chave); outros
// sites pelo <title> ou og:title da própria página, com limites de segurança.

/** Primeiro link http(s) do texto, sem a pontuação de fim de frase. */
export function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"')\]]+/)
  return m ? m[0].replace(/[.,;:!?]+$/, '') : null
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\./, '')
    return host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com'
  } catch {
    return false
  }
}

/**
 * Só endereços públicos: nada de localhost, IPs da rede local ou do próprio PC. O servidor
 * busca o título em nome da pessoa e não pode virar porta de entrada para a rede dela.
 */
export function isPublicHttpUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  if (u.username || u.password) return false
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host.includes('.') && !host.includes(':')) return false // "localhost", nomes da rede local
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))
      return false
    if (a >= 224) return false
  }
  if (host.includes(':')) {
    // IPv6 literal: só aceita se não for loopback, link-local ou rede local.
    if (host === '::1' || host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd') || host === '::') return false
  }
  return true
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
}

/** og:title, se houver; senão o <title>. */
export function titleFromHtml(html: string): string | null {
  const og =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i)
  const raw = og?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  if (!raw) return null
  const title = decodeEntities(raw).replace(/\s+/g, ' ').trim()
  return title ? title.slice(0, 200) : null
}

const TIMEOUT_MS = 3000
const MAX_HTML_BYTES = 256 * 1024

async function youTubeTitle(url: string): Promise<string | null> {
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return null
  const json = (await res.json()) as { title?: unknown }
  return typeof json.title === 'string' && json.title.trim() ? json.title.trim().slice(0, 200) : null
}

/** Título da página, seguindo no máximo um redirecionamento (que também precisa ser público). */
async function pageTitle(url: string, hops = 1): Promise<string | null> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'manual',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JustSay/1.0', Accept: 'text/html' },
  })
  if (res.status >= 300 && res.status < 400) {
    const next = res.headers.get('location')
    await res.body?.cancel()
    const target = next ? new URL(next, url).toString() : null
    return target && hops > 0 && isPublicHttpUrl(target) ? pageTitle(target, hops - 1) : null
  }
  return readTitle(res)
}

/** Lê só o começo da página (o título fica no <head>). */
async function readTitle(res: Response): Promise<string | null> {
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html') || !res.body) {
    await res.body?.cancel()
    return null
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < MAX_HTML_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
    const soFar = new TextDecoder().decode(Buffer.concat(chunks))
    if (/<\/title>/i.test(soFar) && /<\/head>|<body/i.test(soFar)) break
  }
  await reader.cancel().catch(() => {})
  return titleFromHtml(new TextDecoder().decode(Buffer.concat(chunks)))
}

/** Título do link: YouTube pelo oEmbed, outros sites pela página. null se não deu. */
export async function fetchLinkTitle(url: string): Promise<string | null> {
  if (!isPublicHttpUrl(url)) return null
  try {
    return isYouTubeUrl(url) ? await youTubeTitle(url) : await pageTitle(url)
  } catch {
    return null
  }
}
