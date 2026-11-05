// AudioWorklet de captura: junta as amostras em blocos de 1024
// e manda para a thread da página. Carregado por Blob URL para funcionar igual em dev
// (http) e no app empacotado (file://).
import { AUDIO } from '../../../shared/constants'

export const CAPTURE_PROCESSOR = 'just-say-capture'

const SOURCE = `
class JustSayCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.block = new Float32Array(${AUDIO.WORKLET_BLOCK_SAMPLES})
    this.filled = 0
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        if (this.filled > 0) {
          const rest = this.block.slice(0, this.filled)
          this.port.postMessage(rest, [rest.buffer])
          this.filled = 0
        }
        this.port.postMessage('flushed')
      }
    }
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    let offset = 0
    while (offset < channel.length) {
      const n = Math.min(channel.length - offset, this.block.length - this.filled)
      this.block.set(channel.subarray(offset, offset + n), this.filled)
      this.filled += n
      offset += n
      if (this.filled === this.block.length) {
        const full = this.block
        this.port.postMessage(full, [full.buffer])
        this.block = new Float32Array(${AUDIO.WORKLET_BLOCK_SAMPLES})
        this.filled = 0
      }
    }
    return true
  }
}
registerProcessor('${CAPTURE_PROCESSOR}', JustSayCapture)
`

let url: string | null = null

export function captureWorkletUrl(): string {
  url ??= URL.createObjectURL(new Blob([SOURCE], { type: 'application/javascript' }))
  return url
}
