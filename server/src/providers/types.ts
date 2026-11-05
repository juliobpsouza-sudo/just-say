// Contratos dos provedores de STT e de refino, e os erros que a cascata entende.

/** O provedor recusou por limite de uso. `retryAfterMs` = quando deve liberar. */
export class ProviderLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message)
  }
}

/**
 * O provedor recusou só este pedido por ser grande demais para o limite por minuto
 * (ex.: o Qwen aceita no máximo 1000 tokens de saída por minuto). Os próximos pedidos,
 * menores, podem passar: a cascata pula para o próximo modelo sem bloquear este.
 */
export class ProviderRequestTooLargeError extends Error {}

/** O provedor está fora do ar, mal configurado ou demorou demais. */
export class ProviderUnavailableError extends Error {}

/** Nem chegou ao provedor (sem internet, DNS, conexão recusada): a culpa é da rede, não dele. */
export class ProviderNetworkError extends ProviderUnavailableError {}

export interface ProviderInfo {
  id: string
  label: string
  /** Gratuito? Mostrado na tela de Modelos. */
  free: boolean
  isConfigured(): boolean
}

export interface SttRequest {
  audio: Buffer
  filename: string
  mimeType: string
  /** Código ISO-639-1 (ex.: "pt"). Vazio = detecção automática. */
  language?: string
  prompt?: string
  signal: AbortSignal
}

export interface SttResult {
  text: string
  language?: string
}

export interface SttProvider extends ProviderInfo {
  transcribe(req: SttRequest): Promise<SttResult>
}

export interface LlmRequest {
  system: string
  user: string
  maxTokens: number
  /** O que devolver se o provedor for o "sem refino". */
  fallbackText: string
  signal: AbortSignal
}

export interface LlmProvider extends ProviderInfo {
  /** Devolve o texto bruto do modelo (o chamador extrai o resultado). */
  complete(req: LlmRequest): Promise<string>
  /** true = não chama modelo nenhum, devolve `fallbackText`. */
  readonly passthrough?: boolean
  /** true = roda na placa do PC (D94): só para limpar ditado, não para Ask, tradução e estilo. */
  readonly local?: boolean
}

export interface SearchSource {
  title: string
  url: string
}

export interface SearchRequest {
  system: string
  user: string
  maxTokens: number
  signal: AbortSignal
}

export interface SearchResult {
  /** Resposta do modelo, ainda com as marcas de citação. */
  answer: string
  sources: SearchSource[]
  queries: string[]
}

/** Modelo com busca na web embutida (Ask Anything, pergunta sobre algo atual). */
export interface SearchProvider extends ProviderInfo {
  search(req: SearchRequest): Promise<SearchResult>
}

export function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}
