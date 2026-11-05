// Logs por sessão de gravação em JSONL: userData/Logs/recording_events/<data>_<sessão>.jsonl
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

let dir: string | null = null

function logDir(): string {
  if (!dir) {
    dir = join(app.getPath('userData'), 'Logs', 'recording_events')
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function logRecordingEvent(sessionId: string, entry: Record<string, unknown>): void {
  const day = new Date().toISOString().slice(0, 10)
  const line = JSON.stringify({ t: new Date().toISOString(), sessionId, ...entry })
  try {
    appendFileSync(join(logDir(), `${day}_${sessionId}.jsonl`), `${line}\n`)
  } catch (err) {
    console.error('[logs] falha ao gravar log de sessão', err)
  }
}

export function recordingLogDir(): string {
  return logDir()
}
