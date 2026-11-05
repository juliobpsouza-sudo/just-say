// Pedidos de voz no main: envia ao servidor, guarda o último resultado e refaz.
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clipboard } from 'electron'
import { TIMING } from '../shared/constants'
import type { LastVoiceFlow, VoiceFlowRequest, VoiceFlowResult } from '../shared/voiceFlow'
import { storedRequestFrom } from '../shared/history'
import { recordingsDir } from './audio'
import { historyRow, recordVoiceFlow } from './history/historyService'
import { voiceFlow } from './server/client'

let last: LastVoiceFlow | null = null
let onLastChanged: (last: LastVoiceFlow) => void = () => {}

export function setLastVoiceFlowListener(fn: (last: LastVoiceFlow) => void): void {
  onLastChanged = fn
}

export function lastVoiceFlow(): LastVoiceFlow | null {
  return last
}

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/

async function savedWav(audioId: string): Promise<Buffer> {
  if (!SAFE_ID.test(audioId)) throw new Error('id de sessão inválido')
  return readFile(join(recordingsDir(), `${audioId}.wav`))
}

export async function runVoiceFlow(req: VoiceFlowRequest): Promise<VoiceFlowResult> {
  let wav: Buffer
  try {
    wav = req.wav ? Buffer.from(req.wav) : await savedWav(req.audioId)
  } catch {
    return { ok: false, error: { code: 'no_audio', message: 'O áudio desta gravação não foi encontrado.' }, ms: 0 }
  }
  const result = await voiceFlow({ ...req, wav: undefined }, wav)
  if (!(result.ok === false && result.error.code === 'aborted')) {
    recordVoiceFlow(req, result)
    last = {
      sessionId: req.audioId,
      at: Date.now(),
      ok: result.ok,
      mode: req.mode,
      transcript: result.ok ? (result.data.debug?.transcript ?? null) : null,
      refined: result.ok ? result.data.refine_text : null,
      sttProvider: result.ok ? (result.data.debug?.stt.provider ?? null) : null,
      refineProvider: result.ok ? (result.data.debug?.refine.provider ?? null) : null,
      serverMs: result.ok ? (result.data.debug?.total_ms ?? null) : null,
      roundTripMs: result.ms,
      error: result.ok ? null : { code: result.error.code, message: result.error.message },
      delivery: result.ok ? result.data.delivery : null,
      askAction: result.ok ? (result.data.debug?.ask?.action ?? null) : null,
      searchProvider: result.ok ? (result.data.debug?.ask?.search?.provider ?? null) : null,
      sources: result.ok ? (result.data.web_metadata?.sources ?? []) : [],
      selectedChars: typeof req.parameters.selected_text === 'string' ? req.parameters.selected_text.length : 0,
      outputLanguage: typeof req.parameters.output_language === 'string' ? req.parameters.output_language : null,
      request: { audioContext: req.audioContext, audioMetadata: req.audioMetadata, parameters: req.parameters },
    }
    onLastChanged(last)
  }
  return result
}

/**
 * Refaz o último ditado a partir do áudio salvo e copia o resultado.
 * Copia em vez de colar: quem pede o refazer está no Hub, não no campo de destino.
 */
export async function retryLastVoiceFlow(): Promise<VoiceFlowResult> {
  if (!last) return { ok: false, error: { code: 'nothing_to_retry', message: 'Ainda não há ditado para refazer.' }, ms: 0 }
  return retryVoiceFlow(last.sessionId, last.mode, last.request)
}

/** Refaz um item do histórico, com o pedido salvo, e copia o resultado. */
export async function retryHistoryItem(id: string): Promise<VoiceFlowResult> {
  const row = typeof id === 'string' ? historyRow(id) : null
  if (!row) return { ok: false, error: { code: 'nothing_to_retry', message: 'Item não encontrado no histórico.' }, ms: 0 }
  return retryVoiceFlow(row.id, row.mode, storedRequestFrom(row))
}

async function retryVoiceFlow(
  audioId: string,
  mode: VoiceFlowRequest['mode'],
  request: Pick<VoiceFlowRequest, 'audioContext' | 'audioMetadata' | 'parameters'>,
): Promise<VoiceFlowResult> {
  const now = Date.now()
  const result = await runVoiceFlow({
    requestId: randomUUID(),
    audioId,
    mode,
    ...request,
    userOverTime: now,
    sendTime: now,
    isRetry: true,
    timeoutMs: TIMING.HTTP_VOICE_FLOW_TIMEOUT_MS,
  })
  if (result.ok && result.data.refine_text) void clipboard.writeText(result.data.refine_text)
  return result
}
