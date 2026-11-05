// Histórico local (`history_v2`): tipos e a conversão de um pedido
// de voz em linha da tabela. Funções puras, testadas em tests/history.test.ts.
import type { VoiceFlowMode, VoiceFlowRequest, VoiceFlowResult, WebSource } from './voiceFlow'

export type HistoryStatus = 'completed' | 'error'

/** Linha da tabela `history_v2` (colunas base + extensões do Just Say, D62). */
export interface HistoryRow {
  id: string
  user_id: string
  status: HistoryStatus
  mode: VoiceFlowMode
  refined_text: string | null
  duration: number | null
  created_at: string
  updated_at: string
  audio_local_path: string | null
  audio_metadata: string | null
  app_version: string
  mic_device: string | null
  client_metadata: string | null
  mode_meta: string | null
  debug_info: string | null
  audio_context: string | null
  // extensões
  raw_text: string | null
  edited_text: string | null
  focused_app: string | null
  focused_domain: string | null
  error_code: string | null
  error_message: string | null
}

/** O que a tela de Histórico mostra. */
export interface HistoryItem {
  id: string
  status: HistoryStatus
  mode: VoiceFlowMode
  text: string | null
  rawText: string | null
  editedText: string | null
  createdAt: string
  durationS: number | null
  app: string | null
  domain: string | null
  delivery: 'replace' | 'reply' | 'external' | null
  userPrompt: string | null
  outputLanguage: string | null
  selectedChars: number
  sources: WebSource[]
  errorMessage: string | null
  hasAudio: boolean
}

export interface HistoryQuery {
  /** Busca no texto final, na transcrição e no pedido do Ask Anything. */
  text?: string
  mode?: VoiceFlowMode | null
  /** Paginação: itens criados antes deste ISO. */
  before?: string | null
  limit?: number
}

export interface HistoryPage {
  items: HistoryItem[]
  /** Cursor da próxima página; null = acabou. */
  next: string | null
}

/** Opções de guarda no Hub (segundos; -1 = para sempre, o padrão). */
export const HISTORY_RETENTION_OPTIONS: readonly { seconds: number; label: string }[] = [
  { seconds: -1, label: 'Para sempre' },
  { seconds: 365 * 86_400, label: '1 ano' },
  { seconds: 90 * 86_400, label: '3 meses' },
  { seconds: 30 * 86_400, label: '1 mês' },
  { seconds: 7 * 86_400, label: '1 semana' },
  { seconds: 86_400, label: '1 dia' },
]

interface ModeMeta {
  parameters?: Record<string, unknown>
  selected_text?: string
  output_language?: string | null
  ai_result?: {
    user_prompt: string | null
    refined_text: string
    web_metadata: unknown
    external_action: unknown
    delivery: string
  }
}

const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v))

/** Pedido + resposta → linha do histórico. `previous`: a linha já salva (refazer). */
export function historyRowFrom(
  req: Pick<VoiceFlowRequest, 'audioId' | 'mode' | 'audioContext' | 'audioMetadata' | 'parameters' | 'isRetry'>,
  result: VoiceFlowResult,
  opts: { now: string; appVersion: string; audioPath: string | null; previous?: HistoryRow | null },
): HistoryRow {
  const ctx = (req.audioContext ?? {}) as Record<string, any>
  const app = ctx.active_application ?? {}
  const meta = req.audioMetadata as { duration_ms?: unknown }
  const durationMs = typeof meta?.duration_ms === 'number' ? meta.duration_ms : null
  const modeMeta: ModeMeta = { parameters: req.parameters }
  if (typeof req.parameters.selected_text === 'string') modeMeta.selected_text = req.parameters.selected_text
  if (typeof req.parameters.output_language === 'string') modeMeta.output_language = req.parameters.output_language
  if (result.ok && req.mode === 'voice_command')
    modeMeta.ai_result = {
      user_prompt: result.data.user_prompt,
      refined_text: result.data.refine_text,
      web_metadata: result.data.web_metadata,
      external_action: result.data.external_action,
      delivery: result.data.delivery,
    }
  const prev = opts.previous ?? null
  return {
    id: req.audioId,
    user_id: 'local',
    status: result.ok ? 'completed' : 'error',
    mode: req.mode,
    refined_text: result.ok ? result.data.refine_text : (prev?.refined_text ?? null),
    duration: durationMs !== null ? durationMs / 1000 : (prev?.duration ?? null),
    created_at: prev?.created_at ?? opts.now,
    updated_at: opts.now,
    audio_local_path: opts.audioPath,
    audio_metadata: json(req.audioMetadata),
    app_version: opts.appVersion,
    mic_device: prev?.mic_device ?? null,
    client_metadata: json({ is_retry: req.isRetry, round_trip_ms: result.ms }),
    mode_meta: json(modeMeta),
    debug_info: result.ok ? json(result.data.debug ?? null) : (prev?.debug_info ?? null),
    audio_context: json(req.audioContext),
    raw_text: result.ok ? (result.data.debug?.transcript ?? null) : (prev?.raw_text ?? null),
    edited_text: prev?.edited_text ?? null,
    focused_app: typeof app.name === 'string' ? app.name : null,
    focused_domain: typeof app.browser_context?.domain === 'string' ? app.browser_context.domain : null,
    error_code: result.ok ? null : result.error.code,
    error_message: result.ok ? null : result.error.message,
  }
}

const parse = <T,>(s: string | null): T | null => {
  if (!s) return null
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

export function historyItemFrom(row: HistoryRow, hasAudio: boolean): HistoryItem {
  const meta = parse<ModeMeta>(row.mode_meta) ?? {}
  const ai = meta.ai_result
  const web = (ai?.web_metadata ?? null) as { sources?: WebSource[] } | null
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    text: row.refined_text,
    rawText: row.raw_text,
    editedText: row.edited_text,
    createdAt: row.created_at,
    durationS: row.duration,
    app: row.focused_app,
    domain: row.focused_domain,
    delivery: (ai?.delivery as HistoryItem['delivery']) ?? (row.status === 'completed' ? 'replace' : null),
    userPrompt: ai?.user_prompt ?? null,
    outputLanguage: meta.output_language ?? null,
    selectedChars: meta.selected_text?.length ?? 0,
    sources: Array.isArray(web?.sources) ? web.sources : [],
    errorMessage: row.error_message,
    hasAudio,
  }
}

/** Pedido salvo, para refazer igual. */
export function storedRequestFrom(row: HistoryRow): Pick<VoiceFlowRequest, 'audioContext' | 'audioMetadata' | 'parameters'> {
  return {
    audioContext: parse<Record<string, unknown>>(row.audio_context) ?? {},
    audioMetadata: parse<Record<string, unknown>>(row.audio_metadata) ?? {},
    parameters: parse<ModeMeta>(row.mode_meta)?.parameters ?? {},
  }
}

/**
 * Busca do usuário → consulta FTS5: cada palavra vira um prefixo entre aspas ("reun"* acha
 * "reunião"). Aspas e operadores do usuário são neutralizados.
 */
export function ftsQuery(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 12)
  return tokens.length ? tokens.map((t) => `"${t}"*`).join(' ') : null
}
