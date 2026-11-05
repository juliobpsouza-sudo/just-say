// Detecção de silêncio: 1 s depois do início, analisa o volume
// por 5 s. Se nada passar do limiar nessa janela, avisa "nenhuma fala detectada".
// O tempo é contado em amostras, não no relógio, para não depender de atrasos do áudio.
import { AUDIO, TIMING } from '../../../shared/constants'

export type SilenceVerdict = 'pending' | 'speech' | 'no_speech'

export interface SilenceOptions {
  sampleRate: number
  startDelayMs: number
  windowMs: number
  /** RMS mínimo de um trecho para contar como fala (0–1). Ver DECISOES.md. */
  rmsThreshold: number
}

export const DEFAULT_SILENCE_OPTIONS: SilenceOptions = {
  sampleRate: AUDIO.SAMPLE_RATE,
  startDelayMs: TIMING.SILENCE_START_DELAY_MS,
  windowMs: TIMING.SILENCE_WINDOW_MS,
  rmsThreshold: 0.01,
}

export class SilenceDetector {
  private samples = 0
  private verdict: SilenceVerdict = 'pending'
  private readonly startSample: number
  private readonly endSample: number

  constructor(private readonly opts: SilenceOptions = DEFAULT_SILENCE_OPTIONS) {
    this.startSample = Math.round((opts.startDelayMs / 1000) * opts.sampleRate)
    this.endSample = Math.round(((opts.startDelayMs + opts.windowMs) / 1000) * opts.sampleRate)
  }

  get result(): SilenceVerdict {
    return this.verdict
  }

  /** Recebe um bloco de amostras float. Devolve o veredito atual. */
  feed(block: Float32Array): SilenceVerdict {
    if (this.verdict !== 'pending') return this.verdict
    const blockStart = this.samples
    this.samples += block.length
    const from = Math.max(0, this.startSample - blockStart)
    const to = Math.min(block.length, this.endSample - blockStart)
    if (to > from) {
      let sum = 0
      for (let i = from; i < to; i++) sum += block[i] * block[i]
      if (Math.sqrt(sum / (to - from)) >= this.opts.rmsThreshold) this.verdict = 'speech'
    }
    if (this.verdict === 'pending' && this.samples >= this.endSample) this.verdict = 'no_speech'
    return this.verdict
  }
}
