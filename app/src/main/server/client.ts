// Cliente do servidor local: token, saúde, voice_flow (HTTP multipart) e provedores.
import { hostname } from 'node:os'
import Store from 'electron-store'
import { TIMING } from '../../shared/constants'
import type { DictionaryEntry, StyleState } from '../../shared/dictionary'
import type { UsageReport } from '../../shared/usage'
import type { VoiceFlowRequest, VoiceFlowResponse, VoiceFlowResult } from '../../shared/voiceFlow'
import { settingsStore } from '../settings'

// JUST_SAY_PORT: outra porta para rodar uma segunda cópia ao lado (perfil de teste, D95).
const DEFAULT_HOST = `http://127.0.0.1:${process.env.JUST_SAY_PORT || 8787}`

interface UserData {
  serverToken: string | null
}

let userData: Store<UserData> | null = null
function userStore(): Store<UserData> {
  userData ??= new Store<UserData>({ name: 'user-data', defaults: { serverToken: null } })
  return userData
}

export function serverBaseUrl(): string {
  return (settingsStore().get('__DEV_API_HOST') || DEFAULT_HOST).replace(/\/$/, '')
}

async function pair(): Promise<string> {
  const res = await fetch(`${serverBaseUrl()}/auth/local-pair`, { method: 'POST', signal: AbortSignal.timeout(3000) })
  if (!res.ok) throw new Error(`pareamento recusado (${res.status})`)
  const { token } = (await res.json()) as { token: string }
  userStore().set('serverToken', token)
  return token
}

/** fetch autenticado; num 401 pareia de novo e repete uma vez. */
async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = userStore().get('serverToken') ?? (await pair())
  const doFetch = () =>
    fetch(`${serverBaseUrl()}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    })
  let res = await doFetch()
  if (res.status === 401) {
    token = await pair()
    res = await doFetch()
  }
  return res
}

/** POST com JSON autenticado no servidor local. */
export async function postServerJson(path: string, body: unknown): Promise<Response> {
  return authedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export async function serverHealth(): Promise<{ ok: boolean; groqConfigured: boolean }> {
  try {
    const res = await fetch(`${serverBaseUrl()}/health`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return { ok: false, groqConfigured: false }
    const json = (await res.json()) as { ok?: boolean; groq_configured?: boolean }
    return { ok: json.ok === true, groqConfigured: json.groq_configured === true }
  } catch {
    return { ok: false, groqConfigured: false }
  }
}

// ---------- voice_flow ----------

const inFlight = new Map<string, AbortController>()

export function abortVoiceFlow(requestId: string): void {
  inFlight.get(requestId)?.abort()
}

export async function voiceFlow(req: VoiceFlowRequest, wav: Buffer): Promise<VoiceFlowResult> {
  const started = Date.now()
  const controller = new AbortController()
  inFlight.set(req.requestId, controller)
  const timeoutMs = Math.min(req.timeoutMs, TIMING.HTTP_VOICE_FLOW_TIMEOUT_MS)
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)])

  const form = new FormData()
  form.append('audio_id', req.audioId)
  form.append('mode', req.mode)
  form.append('audio_file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), `${req.audioId}.wav`)
  form.append('audio_context', JSON.stringify(req.audioContext))
  form.append('audio_metadata', JSON.stringify(req.audioMetadata))
  form.append('user_over_time', String(req.userOverTime))
  form.append('send_time', String(req.sendTime))
  form.append('is_retry', String(req.isRetry))
  form.append('device_name', hostname())
  form.append('parameters', JSON.stringify(req.parameters))

  try {
    const res = await authedFetch('/ai/voice_flow', { method: 'POST', body: form, signal })
    const json = (await res.json().catch(() => ({}))) as VoiceFlowResponse & {
      error?: { code?: string; message?: string; transcript?: unknown }
    }
    if (!res.ok) {
      return {
        ok: false,
        error: {
          code: json.error?.code ?? 'server_error',
          message: json.error?.message ?? `erro ${res.status}`,
          status: res.status,
          ...(typeof json.error?.transcript === 'string' ? { transcript: json.error.transcript } : {}),
        },
        ms: Date.now() - started,
      }
    }
    return { ok: true, data: json, ms: Date.now() - started }
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } }
    const code = controller.signal.aborted
      ? 'aborted'
      : e.name === 'TimeoutError' || e.name === 'AbortError'
        ? 'timeout'
        : 'server_offline'
    const message =
      code === 'timeout'
        ? 'O servidor demorou demais para responder.'
        : code === 'aborted'
          ? 'Pedido cancelado.'
          : 'O servidor do Just Say não está rodando.'
    return { ok: false, error: { code, message }, ms: Date.now() - started }
  } finally {
    inFlight.delete(req.requestId)
  }
}

// ---------- uso gratuito ----------

export async function getUsage(): Promise<UsageReport | null> {
  try {
    const res = await authedFetch('/usage', { signal: AbortSignal.timeout(3000) })
    return res.ok ? ((await res.json()) as UsageReport) : null
  } catch {
    return null
  }
}

// ---------- provedores (tela Modelos) ----------

export async function getProviders(): Promise<unknown> {
  const res = await authedFetch('/settings/providers', { signal: AbortSignal.timeout(3000) })
  if (!res.ok) throw new Error(`erro ${res.status}`)
  return res.json()
}

export async function setProviders(settings: unknown): Promise<unknown> {
  const res = await authedFetch('/settings/providers', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
    signal: AbortSignal.timeout(3000),
  })
  if (!res.ok) throw new Error(`erro ${res.status}`)
  return res.json()
}

export async function unblockProvider(id: string): Promise<unknown> {
  const res = await authedFetch('/settings/providers/unblock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
    signal: AbortSignal.timeout(3000),
  })
  if (!res.ok) throw new Error(`erro ${res.status}`)
  return res.json()
}

// ---------- dicionário ----------

async function postJson<T>(path: string, body: unknown, timeoutMs = 5000): Promise<T> {
  const res = await authedFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } }
  if (!res.ok) throw new ServerError(json.error?.code ?? 'server_error', json.error?.message ?? `erro ${res.status}`)
  return json
}

export class ServerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export function dictionaryList(): Promise<{ items: DictionaryEntry[] }> {
  return postJson('/user/dictionary/list', {})
}

export function dictionaryAdd(term: string): Promise<{ item: DictionaryEntry }> {
  return postJson('/user/dictionary/add', { term })
}

export function dictionaryUpdate(id: string, term: string): Promise<{ item: DictionaryEntry }> {
  return postJson('/user/dictionary/update', { id, term })
}

export function dictionaryDelete(id: string): Promise<{ deleted: boolean }> {
  return postJson('/user/dictionary/delete', { id })
}

export function dictionaryImport(terms: string[]): Promise<{ added: number; skipped: number }> {
  return postJson('/user/dictionary/import', { terms }, 20_000)
}

// ---------- aprendizado por edição ----------

export interface TraitsResult {
  auto_add_dictionary: { term: string; user_dictionary_id: string } | null
  added: { term: string; user_dictionary_id: string }[]
}

export function sendTraits(body: { inserted_text: string; before: string; after: string; app: string | null; device: string }): Promise<TraitsResult> {
  return postJson('/user/traits', body)
}

// ---------- estilo pessoal ----------

export function styleGet(): Promise<StyleState> {
  return authedFetch('/user/personal_stats', { signal: AbortSignal.timeout(3000) }).then((r) => r.json() as Promise<StyleState>)
}

export function styleSetEnabled(on: boolean): Promise<StyleState> {
  return postJson('/user/update_settings', { personal_auto_style_on: on })
}

export function styleRebuild(samples: string[]): Promise<StyleState> {
  return postJson('/user/personal_style/rebuild', { samples }, 30_000)
}

export function styleReset(): Promise<StyleState> {
  return postJson('/user/personal_style/reset', {})
}

// ---------- Notion (D72) ----------

export interface NotionView {
  configured: boolean
  folders: { id: string; kind: 'data_source' | 'page'; title: string; url: string | null }[]
  default_folder_id: string | null
  error: string | null
}

export async function notionGet(refresh = false): Promise<NotionView> {
  if (refresh) return postJson('/integrations/notion/refresh', {}, 15_000)
  const res = await authedFetch('/integrations/notion', { signal: AbortSignal.timeout(15_000) })
  return (await res.json()) as NotionView
}

export async function notionSetDefault(id: string | null): Promise<NotionView> {
  const res = await authedFetch('/integrations/notion/default', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
    signal: AbortSignal.timeout(15_000),
  })
  return (await res.json()) as NotionView
}

export function notionUndo(kind: string, id: string): Promise<{ ok: boolean }> {
  return postJson('/integrations/notion/undo', { kind, id }, 15_000)
}
