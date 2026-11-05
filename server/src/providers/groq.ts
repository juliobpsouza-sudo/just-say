// Provedores do Groq (plano gratuito): Whisper para STT e modelos abertos para o refino.
// API compatível com a da OpenAI em https://api.groq.com/openai/v1.
import { config } from '../config.ts'
import { recordUsage } from '../usage.ts'
import {
  isAbort,
  ProviderLimitError,
  ProviderNetworkError,
  ProviderRequestTooLargeError,
  ProviderUnavailableError,
  type LlmProvider,
  type LlmRequest,
  type SearchProvider,
  type SearchRequest,
  type SearchResult,
  type SearchSource,
  type SttProvider,
  type SttRequest,
  type SttResult,
} from './types.ts'

const BASE = 'https://api.groq.com/openai/v1'

/** "43.2s", "500ms", "1m30s", "2h0m" → ms. */
export function parseGroqDuration(value: string | null): number | null {
  if (!value) return null
  let total = 0
  let matched = false
  for (const [, num, unit] of value.matchAll(/([\d.]+)(ms|h|m|s)/g)) {
    matched = true
    const n = Number(num)
    total += unit === 'h' ? n * 3_600_000 : unit === 'm' ? n * 60_000 : unit === 's' ? n * 1000 : n
  }
  return matched ? Math.round(total) : null
}

/** Quanto esperar depois de um 429: retry-after (s) ou o maior reset informado. */
export function retryAfterFromHeaders(headers: Headers): number {
  const retryAfter = Number(headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000
  // Sem retry-after: o reset do balde que esvaziou (tokens por minuto ou pedidos do dia), não o
  // maior dos dois, que fazia o limite por minuto parecer de horas (D92).
  const exhausted = ['tokens', 'requests', 'audio-seconds']
    .filter((b) => headers.get(`x-ratelimit-remaining-${b}`) === '0')
    .map((b) => parseGroqDuration(headers.get(`x-ratelimit-reset-${b}`) ?? ''))
    .filter((v): v is number => v !== null)
  if (exhausted.length) return Math.max(...exhausted)
  const resets = [...headers]
    .filter(([k]) => k.startsWith('x-ratelimit-reset'))
    .map(([, v]) => parseGroqDuration(v))
    .filter((v): v is number => v !== null)
  return resets.length ? Math.max(...resets) : 60_000
}

/**
 * 429 do tipo "Request too large … (OTPM): Limit 1000, Requested 1024": o pedido sozinho
 * passa do limite por minuto. Não é o limite esgotado (D57).
 */
export function isRequestTooLarge(body: string): boolean {
  return /request too large/i.test(body)
}

async function groqFetch(path: string, init: RequestInit, provider: { id: string; label: string }): Promise<Response> {
  const { label } = provider
  if (!config.groqApiKey) throw new ProviderUnavailableError(`${label}: GROQ_API_KEY não configurada`)
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${config.groqApiKey}`, ...(init.headers ?? {}) },
    })
  } catch (err) {
    if (isAbort(err)) throw err
    const cause = (err as { cause?: { code?: string } }).cause?.code
    throw new ProviderNetworkError(`${label}: sem conexão (${cause ?? (err as Error).message})`)
  }
  // Toda resposta do Groq (inclusive o 429) informa quanto do limite gratuito resta.
  recordUsage(provider.id, res.headers)
  if (res.status === 429) {
    const body = await res.text().catch(() => '')
    if (isRequestTooLarge(body)) throw new ProviderRequestTooLargeError(`${label}: pedido grande demais para o limite por minuto`)
    throw new ProviderLimitError(`${label}: limite do plano gratuito atingido`, retryAfterFromHeaders(res.headers))
  }
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel()
    throw new ProviderUnavailableError(`${label}: chave recusada (${res.status})`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ProviderUnavailableError(`${label}: erro ${res.status} ${body.slice(0, 200)}`)
  }
  return res
}

export class GroqStt implements SttProvider {
  readonly free = true
  readonly id: string
  readonly label: string

  constructor(private readonly model: string) {
    this.id = `groq:${model}`
    this.label = `Groq · ${model}`
  }

  isConfigured(): boolean {
    return Boolean(config.groqApiKey)
  }

  async transcribe(req: SttRequest): Promise<SttResult> {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(req.audio)], { type: req.mimeType }), req.filename)
    form.append('model', this.model)
    form.append('response_format', 'verbose_json')
    form.append('temperature', '0')
    if (req.language) form.append('language', req.language)
    if (req.prompt) form.append('prompt', req.prompt)
    const res = await groqFetch('/audio/transcriptions', { method: 'POST', body: form, signal: req.signal }, this)
    const json = (await res.json()) as { text?: string; language?: string }
    return { text: (json.text ?? '').trim(), language: json.language }
  }
}

export class GroqLlm implements LlmProvider {
  readonly free = true
  readonly id: string
  readonly label: string

  constructor(
    private readonly model: string,
    private readonly extra: Record<string, unknown> = {},
  ) {
    this.id = `groq:${model}`
    this.label = `Groq · ${model}`
  }

  isConfigured(): boolean {
    return Boolean(config.groqApiKey)
  }

  async complete(req: LlmRequest): Promise<string> {
    const res = await groqFetch(
      '/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: req.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_completion_tokens: req.maxTokens,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          ...this.extra,
        }),
      },
      this,
    )
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return json.choices?.[0]?.message?.content ?? ''
  }
}

// ---------- busca na web (ferramenta browser_search do Groq, só nos gpt-oss) ----------

interface ExecutedTool {
  type?: string
  arguments?: string
  search_results?: { results?: { title?: string; url?: string }[] }
}

const SEARCH_ENGINE_HOSTS = ['exa.ai']

/**
 * Fontes a partir das ferramentas executadas: primeiro as páginas que o modelo abriu,
 * depois os resultados da busca. Sem repetir URL e sem a página da própria busca.
 */
export function sourcesFromExecutedTools(tools: ExecutedTool[] | undefined, max = 5): SearchSource[] {
  const opened: SearchSource[] = []
  const listed: SearchSource[] = []
  for (const tool of tools ?? []) {
    // 'browser_search' lista resultados; os outros tipos (ex.: 'browser.open') são páginas abertas.
    const isOpen = tool.type !== 'browser_search'
    for (const r of tool.search_results?.results ?? []) {
      if (typeof r.url !== 'string') continue
      let url: URL
      try {
        url = new URL(r.url)
      } catch {
        continue
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
      if (SEARCH_ENGINE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) continue
      // Página aberta vem com o título "www.site.com - viewing lines [0 - 116] of 116".
      const rawTitle = (r.title ?? '').replace(/ - viewing lines \[.*$/, '').trim()
      ;(isOpen ? opened : listed).push({ title: rawTitle || url.hostname, url: url.toString() })
    }
  }
  const seen = new Set<string>()
  const out: SearchSource[] = []
  for (const s of [...opened, ...listed]) {
    if (seen.has(s.url)) continue
    seen.add(s.url)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

function queriesFromExecutedTools(tools: ExecutedTool[] | undefined): string[] {
  const out: string[] = []
  for (const tool of tools ?? []) {
    if (tool.type !== 'browser_search') continue
    try {
      const q = (JSON.parse(tool.arguments ?? '{}') as { query?: unknown }).query
      if (typeof q === 'string' && q.trim()) out.push(q.trim())
    } catch {
      // argumentos malformados: ignora
    }
  }
  return out
}

export class GroqSearch implements SearchProvider {
  readonly free = true
  readonly id: string
  readonly label: string

  constructor(private readonly model: string) {
    // Mesmo id do modelo de refino: o limite gratuito é por modelo (D54).
    this.id = `groq:${model}`
    this.label = `Groq · ${model} + busca`
  }

  isConfigured(): boolean {
    return Boolean(config.groqApiKey)
  }

  async search(req: SearchRequest): Promise<SearchResult> {
    const res = await groqFetch(
      '/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: req.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0.3,
          max_completion_tokens: req.maxTokens,
          // Raciocínio baixo: com mais, o modelo navega mais e gasta muito mais tokens.
          reasoning_effort: 'low',
          include_reasoning: false,
          tool_choice: 'required',
          tools: [{ type: 'browser_search' }],
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
      },
      this,
    )
    const json = (await res.json()) as { choices?: { message?: { content?: string; executed_tools?: ExecutedTool[] } }[] }
    const message = json.choices?.[0]?.message
    return {
      answer: message?.content ?? '',
      sources: sourcesFromExecutedTools(message?.executed_tools),
      queries: queriesFromExecutedTools(message?.executed_tools),
    }
  }
}
