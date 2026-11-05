// Detector de silêncio para o WAV do ditado (D88). Ligar e soltar o atalho sem falar gera
// silêncio total, e o Whisper inventa texto para ele ("Thank you.", "E aí"). Medido nas
// gravações reais de uso: silêncio tem 0 trechos de 30 ms acima de -50 dBFS; a fala mais baixa
// teve 8. O corte fica em 3, com folga para os dois lados.

/** Trecho de 30 ms com energia (RMS) acima de -50 dBFS conta como "som". */
const WINDOW_MS = 30
const MIN_RMS = 10 ** (-50 / 20)
const MIN_LOUD_WINDOWS = 3

interface PcmView {
  sampleRate: number
  channels: number
  /** Amostras de 16 bits intercaladas por canal. */
  samples: Int16Array
}

/** Lê um WAV PCM de 16 bits. Qualquer outro formato devolve null (não dá para medir). */
export function readPcm16Wav(buf: Buffer): PcmView | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null
  let pos = 12
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    const body = pos + 8
    if (id === 'fmt ' && size >= 16) {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) }
    } else if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16 || fmt.channels < 1 || fmt.sampleRate < 1) return null
      const end = Math.min(buf.length, body + size)
      const count = Math.floor((end - body) / 2)
      // Cópia alinhada: o Buffer pode começar num endereço ímpar.
      const samples = new Int16Array(count)
      for (let i = 0; i < count; i++) samples[i] = buf.readInt16LE(body + i * 2)
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, samples }
    }
    pos = body + size + (size % 2)
  }
  return null
}

/** Quantos trechos de 30 ms passam de -50 dBFS (usa só o primeiro canal). */
export function loudWindows(pcm: PcmView): number {
  const frames = Math.floor(pcm.samples.length / pcm.channels)
  const win = Math.max(1, Math.round((pcm.sampleRate * WINDOW_MS) / 1000))
  let loud = 0
  for (let start = 0; start + win <= frames; start += win) {
    let energy = 0
    for (let f = start; f < start + win; f++) {
      const v = pcm.samples[f * pcm.channels] / 32768
      energy += v * v
    }
    if (Math.sqrt(energy / win) > MIN_RMS) loud++
  }
  return loud
}

/**
 * O áudio tem som suficiente para conter fala? false = silêncio (não vale mandar ao STT);
 * null = formato que não sei medir (manda como sempre).
 */
export function hasSpeechEnergy(wav: Buffer): boolean | null {
  const pcm = readPcm16Wav(wav)
  return pcm ? loudWindows(pcm) >= MIN_LOUD_WINDOWS : null
}
