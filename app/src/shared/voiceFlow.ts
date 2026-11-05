// Tipos do pedido de voz e o contexto mínimo enviado na Fase 3.

export type VoiceFlowMode = 'voice_transcript' | 'voice_command' | 'voice_translation'

export const MODE_TO_VOICE_FLOW: Record<'transcript' | 'ask_anything' | 'translation', VoiceFlowMode> = {
  transcript: 'voice_transcript',
  ask_anything: 'voice_command',
  translation: 'voice_translation',
}

export interface VoiceFlowRequest {
  requestId: string
  audioId: string
  mode: VoiceFlowMode
  /** WAV da sessão. Ausente = usa o arquivo salvo em Recordings (refazer). */
  wav?: ArrayBuffer
  audioContext: Record<string, unknown>
  audioMetadata: Record<string, unknown>
  userOverTime: number
  sendTime: number
  isRetry: boolean
  parameters: Record<string, unknown>
  timeoutMs: number
}

/** `notice` (extensão nossa): só um aviso na barra, ex.: anotado no Notion (D72). */
export type Delivery = 'replace' | 'reply' | 'external' | 'notice'

export interface IntegrationResult {
  service: 'notion'
  folder: string
  title: string
  note_kind: 'page' | 'block'
  note_id: string
  note_url: string | null
}

export interface WebSource {
  title: string
  url: string
}

/** Fontes da busca na web do Ask Anything. */
export interface WebMetadata {
  query: string
  sources: WebSource[]
}

export interface ExternalAction {
  type: 'open_url'
  target: string
}

export type AskAction = 'colar' | 'responder' | 'buscar' | 'abrir' | 'anotar'

export interface VoiceFlowResponse {
  refine_text: string
  delivery: Delivery
  user_prompt: string | null
  web_metadata: WebMetadata | null
  external_action: ExternalAction | null
  integration_result?: IntegrationResult | null
  /** Avisos de uso gratuito (extensão do nosso servidor). */
  notices?: string[]
  /** Hora de refazer o perfil de estilo pessoal (D65). */
  style_refresh_due?: boolean
  debug?: {
    transcript: string
    language: string | null
    stt: { provider: string; ms: number }
    refine: { provider: string; ms: number }
    ask?: { action: AskAction; search?: { provider: string; ms: number; queries: string[] } }
    total_ms: number
  }
}

export type VoiceFlowErrorCode = 'timeout' | 'aborted' | 'server_offline' | 'unauthorized' | 'server_error' | string

export type VoiceFlowResult =
  | { ok: true; data: VoiceFlowResponse; ms: number }
  | {
      ok: false
      /** `transcript`: a fala transcrita, quando a tradução falhou depois da transcrição. */
      error: { code: VoiceFlowErrorCode; message: string; status?: number; transcript?: string }
      ms: number
    }

/** Resumo do último ditado, mostrado no Painel. */
export interface LastVoiceFlow {
  sessionId: string
  at: number
  ok: boolean
  mode: VoiceFlowMode
  transcript: string | null
  refined: string | null
  sttProvider: string | null
  refineProvider: string | null
  serverMs: number | null
  roundTripMs: number
  error: { code: string; message: string } | null
  /** Ask Anything e Tradução (Fase 6). */
  delivery: Delivery | null
  askAction: AskAction | null
  searchProvider: string | null
  sources: WebSource[]
  selectedChars: number
  outputLanguage: string | null
  /** Contexto e parâmetros do pedido, para refazer igual. */
  request: Pick<VoiceFlowRequest, 'audioContext' | 'audioMetadata' | 'parameters'>
}

// ---------- contexto mínimo (o completo vem na Fase 5) ----------

export interface FocusedInputInfo {
  pid: number
  exePath: string
  exeName: string
  title: string
  windowClass: string
  focusClass: string
  hasCaret: boolean
}

export const BROWSER_EXES = [
  'chrome.exe',
  'msedge.exe',
  'firefox.exe',
  'brave.exe',
  'opera.exe',
  'opera_gx.exe',
  'vivaldi.exe',
  'chromium.exe',
  'arc.exe',
  'iexplore.exe',
  'waterfox.exe',
  'tor.exe',
]

export function minimalAudioContext(info: FocusedInputInfo | null, locale: string): Record<string, unknown> {
  const exe = info?.exeName ?? ''
  const isBrowser = BROWSER_EXES.includes(exe.toLowerCase())
  return {
    context_metadata: { version: 'just-say-1', capture: 'minimal' },
    device_environment: { os: 'windows', locale },
    active_application: info
      ? {
          name: exe.replace(/\.exe$/i, ''),
          executable: exe,
          window_title: info.title,
          type: isBrowser ? 'web_browser' : 'native_app',
          pid: info.pid,
        }
      : null,
    text_insertion_point: {
      is_editable: info?.hasCaret ?? null,
      input_capabilities: { is_editable: info?.hasCaret ?? null, supports_markdown: false },
    },
  }
}
