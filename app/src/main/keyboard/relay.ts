// Repasse das teclas para os renderers: throttle de 16 ms (com envio na borda de
// entrada e de saída) e um reenvio 50 ms depois da última mudança.
import { TIMING } from '../../shared/constants'
import type { KeyboardSnapshot } from '../../shared/ipc'

export class KeyboardRelay {
  private latest: KeyboardSnapshot | null = null
  private lastSentAt = Number.NEGATIVE_INFINITY
  private throttleTimer: NodeJS.Timeout | null = null
  private resyncTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly emit: (snapshot: KeyboardSnapshot) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  push(snapshot: KeyboardSnapshot): void {
    this.latest = snapshot
    const elapsed = this.now() - this.lastSentAt
    if (elapsed >= TIMING.KEYBOARD_THROTTLE_MS) {
      this.flush()
    } else if (!this.throttleTimer) {
      this.throttleTimer = setTimeout(() => this.flush(), TIMING.KEYBOARD_THROTTLE_MS - elapsed)
    }
    if (this.resyncTimer) clearTimeout(this.resyncTimer)
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null
      if (this.latest) this.emit(this.latest)
    }, TIMING.KEYBOARD_RESYNC_MS)
  }

  dispose(): void {
    if (this.throttleTimer) clearTimeout(this.throttleTimer)
    if (this.resyncTimer) clearTimeout(this.resyncTimer)
  }

  private flush(): void {
    if (this.throttleTimer) clearTimeout(this.throttleTimer)
    this.throttleTimer = null
    if (!this.latest) return
    this.lastSentAt = this.now()
    this.emit(this.latest)
  }
}
