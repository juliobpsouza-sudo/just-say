// Aprendizado por edição, a parte que observa o campo: depois de colar,
// relê o campo a cada 1 s (e logo depois de cada tecla) por até 15 s. Termina quando o foco vai
// para outro campo, o campo é limpo, a pessoa aperta Enter ou o tempo acaba. Aí compara o trecho
// colado com o que ficou e, se for uma correção pequena, avisa quem pediu.
import { TIMING } from '../shared/constants'
import { editVerdict, locateEdited } from '../shared/editDiff'
import type { KeyboardSnapshot } from '../shared/ipc'
import type { FieldRead } from './native/contextHelper'

/** Espera a colagem assentar (o app de destino processar o Ctrl+V) antes da primeira leitura. */
const BASELINE_DELAY_MS = 800
/** Depois de uma tecla, relê o campo quando a pessoa para de digitar por este tempo. */
const AFTER_KEY_READ_MS = 250
const READ_TIMEOUT_MS = 300
const MAX_FIELD_CHARS = 20_000

export type EditEnd = 'field_changed' | 'cleared' | 'enter' | 'timeout' | 'replaced'

export interface EditResult {
  sessionId: string
  before: string
  after: string
  end: EditEnd
}

interface Deps {
  readField: (timeoutMs: number, maxChars: number) => Promise<FieldRead | null>
  onEdit: (result: EditResult) => void
  now?: () => number
  log?: (line: string) => void
}

interface Session {
  sessionId: string
  inserted: string
  startedAt: number
  fieldId: string | null
  baseline: string | null
  last: string | null
  timers: ReturnType<typeof setTimeout>[]
  keyTimer: ReturnType<typeof setTimeout> | null
  reading: boolean
}

export class EditTracker {
  private session: Session | null = null
  private readonly now: () => number

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => Date.now())
  }

  get active(): boolean {
    return this.session !== null
  }

  /** Começa a observar depois de uma colagem. Uma colagem nova encerra a anterior. */
  start(sessionId: string, inserted: string): void {
    if (this.session) this.finish('replaced')
    if (!inserted.trim()) return
    const s: Session = {
      sessionId,
      inserted,
      startedAt: this.now(),
      fieldId: null,
      baseline: null,
      last: null,
      timers: [],
      keyTimer: null,
      reading: false,
    }
    this.session = s
    s.timers.push(setTimeout(() => void this.readBaseline(s), BASELINE_DELAY_MS))
  }

  /** Teclas do hook global: Enter encerra; as outras pedem uma releitura logo depois. */
  onKey(snapshot: KeyboardSnapshot): void {
    const s = this.session
    if (!s || snapshot.type !== 'down' || s.baseline === null) return
    if (snapshot.key === 'Enter' || snapshot.key === 'NumpadEnter') {
      this.finish('enter')
      return
    }
    if (s.keyTimer) clearTimeout(s.keyTimer)
    s.keyTimer = setTimeout(() => void this.poll(s), AFTER_KEY_READ_MS)
  }

  stop(): void {
    if (this.session) this.clear(this.session)
    this.session = null
  }

  private async readBaseline(s: Session): Promise<void> {
    if (this.session !== s) return
    const field = await this.deps.readField(READ_TIMEOUT_MS, MAX_FIELD_CHARS).catch(() => null)
    if (this.session !== s) return
    // Campo que não dá para ler, senha, ou onde o texto colado não aparece: nada a aprender.
    if (!field || !field.isEditable || field.isPassword || !field.textKnown || !field.text.includes(s.inserted.trim())) {
      this.deps.log?.(`[edição] não observo: ${!field ? 'sem campo' : !field.textKnown ? 'texto ilegível' : 'texto colado não encontrado'}`)
      this.stop()
      return
    }
    s.fieldId = field.id
    s.baseline = field.text
    s.last = field.text
    const tick = () => {
      if (this.session !== s) return
      if (this.now() - s.startedAt >= TIMING.EDIT_TRACK_MAX_MS) {
        this.finish('timeout')
        return
      }
      void this.poll(s).then(() => {
        if (this.session === s) s.timers.push(setTimeout(tick, TIMING.EDIT_TRACK_POLL_MS))
      })
    }
    s.timers.push(setTimeout(tick, TIMING.EDIT_TRACK_POLL_MS))
  }

  private async poll(s: Session): Promise<void> {
    if (this.session !== s || s.reading) return
    s.reading = true
    try {
      const field = await this.deps.readField(READ_TIMEOUT_MS, MAX_FIELD_CHARS).catch(() => null)
      if (this.session !== s || !field) return
      if (field.id !== s.fieldId) this.finish('field_changed')
      else if (!field.text.trim()) this.finish('cleared')
      else if (field.textKnown) s.last = field.text
    } finally {
      s.reading = false
    }
  }

  private clear(s: Session): void {
    s.timers.forEach(clearTimeout)
    if (s.keyTimer) clearTimeout(s.keyTimer)
  }

  /** Compara o trecho colado com o último estado lido do campo. */
  private finish(end: EditEnd): void {
    const s = this.session
    if (!s) return
    this.clear(s)
    this.session = null
    if (s.baseline === null || s.last === null) return
    const located = locateEdited(s.baseline, s.inserted, s.last)
    if (!located) {
      this.deps.log?.(`[edição] fim (${end}): a pessoa mexeu fora do trecho colado`)
      return
    }
    const verdict = editVerdict(located.before, located.after)
    this.deps.log?.(`[edição] fim (${end}): ${verdict.kind}`)
    if (verdict.kind === 'small') this.deps.onEdit({ sessionId: s.sessionId, ...located, end })
  }
}
