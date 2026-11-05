// Supervisor do processo filho do teclado: sobe, repassa comandos e reinicia com
// backoff de 1, 2 e 4 s (teto 5 s), no máximo 3 tentativas.
import { fork, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { TIMING } from '../../shared/constants'
import type { KeyboardSnapshot, KeyboardStatus } from '../../shared/ipc'

/** Atraso antes da tentativa `attempt` (0, 1, 2…), ou null se acabaram as tentativas. */
export function restartDelay(attempt: number): number | null {
  if (attempt >= TIMING.KEYBOARD_CHILD_MAX_RETRIES) return null
  const delay = TIMING.KEYBOARD_CHILD_BACKOFF_MS[attempt] ?? TIMING.KEYBOARD_CHILD_BACKOFF_MAX_MS
  return Math.min(delay, TIMING.KEYBOARD_CHILD_BACKOFF_MAX_MS)
}

interface SupervisorEvents {
  keys: [KeyboardSnapshot]
  status: [KeyboardStatus]
  log: [string]
}

export class KeyboardSupervisor extends EventEmitter<SupervisorEvents> {
  private child: ChildProcess | null = null
  private attempts = 0
  private restarts = 0
  private stopped = false
  private stableTimer: NodeJS.Timeout | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private targets: string[][] = []
  private watcherMs: number = TIMING.KEYBOARD_WATCHER_INTERVAL_MS
  private requestSeq = 0
  private pending = new Map<number, (data: unknown) => void>()
  private _status: KeyboardStatus = { state: 'stopped', restarts: 0, lastError: null }

  constructor(
    private readonly childScript: string,
    private readonly dllPath: string,
  ) {
    super()
  }

  get status(): KeyboardStatus {
    return this._status
  }

  start(): void {
    this.stopped = false
    this.spawn()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    const child = this.child
    this.child = null
    if (child?.connected) child.send({ type: 'stop' })
    setTimeout(() => child?.kill(), 1000).unref()
    this.setStatus({ state: 'stopped' })
  }

  updateTargetShortcuts(shortcuts: string[][]): void {
    this.targets = shortcuts
    this.post({ type: 'updateTargetShortcuts', shortcuts })
  }

  resetPressingKeycodes(): void {
    this.post({ type: 'resetPressingKeycodes' })
  }

  setWatcherInterval(ms: number): void {
    this.watcherMs = ms
    this.post({ type: 'setWatcherInterval', ms })
  }

  getKeyboardDeviceList(): Promise<unknown> {
    return new Promise((resolve) => {
      const requestId = ++this.requestSeq
      this.pending.set(requestId, resolve)
      if (!this.post({ type: 'getKeyboardDeviceList', requestId })) {
        this.pending.delete(requestId)
        resolve([])
      }
    })
  }

  private post(message: unknown): boolean {
    if (!this.child?.connected) return false
    this.child.send(message as object)
    return true
  }

  private spawn(): void {
    this.setStatus({ state: this.restarts > 0 ? 'restarting' : 'starting' })
    const child = fork(this.childScript, [], {
      env: { ...process.env, JUST_SAY_KEYBOARD_LIB_PATH: this.dllPath },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child = child
    child.stdout?.on('data', (d) => this.emit('log', `[teclado] ${String(d).trim()}`))
    child.stderr?.on('data', (d) => this.emit('log', `[teclado:erro] ${String(d).trim()}`))

    child.on('message', (raw) => {
      const msg = raw as { type: string; data?: unknown; message?: string; requestId?: number }
      switch (msg.type) {
        case 'ready':
          // Reenvia a configuração: um filho novo não sabe de nada.
          this.post({ type: 'updateTargetShortcuts', shortcuts: this.targets })
          this.post({ type: 'setWatcherInterval', ms: this.watcherMs })
          this.setStatus({ state: 'running', lastError: null })
          this.stableTimer = setTimeout(() => (this.attempts = 0), TIMING.KEYBOARD_CHILD_STABLE_MS)
          break
        case 'keyboard-event':
          this.emit('keys', msg.data as KeyboardSnapshot)
          break
        case 'keyboard-device-list': {
          const resolve = this.pending.get(msg.requestId ?? -1)
          this.pending.delete(msg.requestId ?? -1)
          resolve?.(msg.data)
          break
        }
        case 'fatal':
          this.setStatus({ lastError: msg.message ?? 'erro desconhecido' })
          this.emit('log', `[teclado] erro fatal: ${msg.message}`)
          break
      }
    })

    child.on('exit', (code, signal) => {
      if (this.child !== child) return
      this.child = null
      if (this.stableTimer) clearTimeout(this.stableTimer)
      if (this.stopped) return
      this.emit('log', `[teclado] processo filho saiu (code=${code}, signal=${signal})`)
      const delay = restartDelay(this.attempts)
      if (delay === null) {
        this.setStatus({ state: 'failed' })
        return
      }
      this.attempts++
      this.restarts++
      this.setStatus({ state: 'restarting' })
      this.restartTimer = setTimeout(() => this.spawn(), delay)
    })
  }

  private clearTimers(): void {
    if (this.stableTimer) clearTimeout(this.stableTimer)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.stableTimer = null
    this.restartTimer = null
  }

  private setStatus(patch: Partial<KeyboardStatus>): void {
    this._status = { ...this._status, ...patch, restarts: this.restarts }
    this.emit('status', this._status)
  }
}
