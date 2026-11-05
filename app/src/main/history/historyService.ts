// Histórico no main: abre o banco em userData/just-say.db, grava cada pedido de voz,
// aplica o tempo de guarda e apaga os áudios junto com as linhas.
import { existsSync } from 'node:fs'
import { readFile, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import {
  historyItemFrom,
  historyRowFrom,
  type HistoryItem,
  type HistoryPage,
  type HistoryQuery,
  type HistoryRow,
} from '../../shared/history'
import { statsEventFrom, summarizeStats, type StatsSummary } from '../../shared/stats'
import type { VoiceFlowRequest, VoiceFlowResult } from '../../shared/voiceFlow'
import { recordingsDir } from '../audio'
import { settingsStore } from '../settings'
import { HistoryDb, retentionCutoff } from './historyDb'

let db: HistoryDb | null = null
let onChanged: () => void = () => {}

function open(): HistoryDb {
  db ??= new HistoryDb(new DatabaseSync(join(app.getPath('userData'), 'just-say.db')))
  return db
}

export function setHistoryChangedListener(fn: () => void): void {
  onChanged = fn
}

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/

function audioPathFor(id: string): string | null {
  return SAFE_ID.test(id) ? join(recordingsDir(), `${id}.wav`) : null
}

/** Grava (ou atualiza, no refazer) o pedido no histórico. Nunca derruba o fluxo de voz. */
export function recordVoiceFlow(
  req: Pick<VoiceFlowRequest, 'audioId' | 'mode' | 'audioContext' | 'audioMetadata' | 'parameters' | 'isRetry'>,
  result: VoiceFlowResult,
): void {
  try {
    const h = open()
    const path = audioPathFor(req.audioId)
    const row = historyRowFrom(req, result, {
      now: new Date().toISOString(),
      appVersion: app.getVersion(),
      audioPath: path && existsSync(path) ? path : null,
      previous: h.get(req.audioId),
    })
    h.upsert(row)
    const event = statsEventFrom(row)
    if (event) h.recordStat(event)
    onChanged()
  } catch (err) {
    console.error('[histórico] falha ao gravar', err)
  }
}

export function historyRow(id: string): HistoryRow | null {
  return open().get(id)
}

function toItem(row: HistoryRow): HistoryItem {
  return historyItemFrom(row, Boolean(row.audio_local_path && existsSync(row.audio_local_path)))
}

export function listHistory(query: HistoryQuery): HistoryPage {
  const { rows, next } = open().list(query)
  return { items: rows.map(toItem), next }
}

export function setEditedText(id: string, text: string): void {
  try {
    open().setEditedText(id, text)
    onChanged()
  } catch (err) {
    console.error('[histórico] falha ao gravar a edição', err)
  }
}

export function recentDictationTexts(limit: number): string[] {
  return open().recentDictationTexts(limit)
}

async function removeAudio(rows: HistoryRow[]): Promise<void> {
  const dir = recordingsDir()
  for (const r of rows) {
    // Só apaga arquivos dentro da pasta de gravações.
    if (r.audio_local_path && r.audio_local_path.startsWith(dir)) await unlink(r.audio_local_path).catch(() => {})
  }
}

export async function deleteHistory(ids: string[]): Promise<number> {
  const removed = open().delete(ids.filter((id) => typeof id === 'string'))
  await removeAudio(removed)
  onChanged()
  return removed.length
}

export async function deleteAllHistory(): Promise<number> {
  const removed = open().deleteAll()
  await removeAudio(removed)
  onChanged()
  return removed.length
}

/** Áudio salvo de um item, para ouvir no Hub. */
export async function historyAudio(id: string): Promise<ArrayBuffer | null> {
  const row = open().get(id)
  if (!row?.audio_local_path || !row.audio_local_path.startsWith(recordingsDir())) return null
  try {
    const buf = await readFile(row.audio_local_path)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  } catch {
    return null
  }
}

/**
 * Tempo de guarda (`historyDurationSeconds`): apaga linhas e áudios mais velhos que o
 * corte. Também apaga gravações soltas (canceladas, sem linha) mais velhas que o corte.
 */
export async function applyRetention(now = Date.now()): Promise<number> {
  const cutoff = retentionCutoff(settingsStore().get('historyDurationSeconds'), now)
  if (!cutoff) return 0
  const removed = open().deleteOlderThan(cutoff)
  await removeAudio(removed)
  const cutoffMs = Date.parse(cutoff)
  try {
    const dir = recordingsDir()
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.wav')) continue
      const file = join(dir, name)
      const info = await stat(file).catch(() => null)
      if (info && info.mtimeMs < cutoffMs) await unlink(file).catch(() => {})
    }
  } catch {
    // pasta ainda não existe
  }
  if (removed.length) onChanged()
  return removed.length
}

/** Resumo para a tela de Estatísticas. */
export function statsSummary(): StatsSummary {
  return summarizeStats(open().statEvents(), { now: new Date(), typingWpm: settingsStore().get('statsTypingWpm') })
}

export function resetStats(): void {
  open().resetStats()
  onChanged()
}

export function closeHistory(): void {
  db?.close()
  db = null
}
