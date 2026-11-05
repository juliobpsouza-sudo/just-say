import { describe, expect, it } from 'vitest'
import { SilenceDetector } from '../src/renderer/src/audio/silence'
import { concatPcm16, encodeWav, floatToPcm16, pcmDurationMs } from '../src/renderer/src/audio/wav'

const SR = 16_000

describe('WAV', () => {
  it('monta o cabeçalho RIFF de PCM16 mono a 16 kHz', () => {
    const pcm = new Int16Array([0, 1000, -1000, 32767])
    const wav = encodeWav(pcm, SR)
    const view = new DataView(wav.buffer)
    const ascii = (o: number, n: number) => String.fromCharCode(...wav.slice(o, o + n))
    expect(wav.length).toBe(44 + 8)
    expect(ascii(0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + 8)
    expect(ascii(8, 4)).toBe('WAVE')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(SR)
    expect(view.getUint32(28, true)).toBe(SR * 2)
    expect(view.getUint16(34, true)).toBe(16)
    expect(ascii(36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(8)
    expect(view.getInt16(46, true)).toBe(1000)
    expect(view.getInt16(50, true)).toBe(32767)
  })

  it('converte float para PCM16 com saturação', () => {
    expect([...floatToPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]))]).toEqual([
      0, 32767, -32768, 32767, -32768, 16384,
    ])
  })

  it('junta blocos e calcula a duração', () => {
    const all = concatPcm16([new Int16Array([1, 2]), new Int16Array([3])])
    expect([...all]).toEqual([1, 2, 3])
    expect(pcmDurationMs(16_000, SR)).toBe(1000)
  })
})

describe('detecção de silêncio', () => {
  const block = (amplitude: number, n = 1024) => new Float32Array(n).fill(amplitude)

  /** Alimenta `ms` de áudio com a amplitude dada e devolve o último veredito. */
  function feed(d: SilenceDetector, ms: number, amplitude: number) {
    let v = d.result
    const blocks = Math.round(((ms / 1000) * SR) / 1024)
    for (let i = 0; i < blocks; i++) v = d.feed(block(amplitude))
    return v
  }

  it('silêncio por 1 s + 5 s vira no_speech', () => {
    const d = new SilenceDetector()
    expect(feed(d, 5900, 0.001)).toBe('pending')
    expect(feed(d, 200, 0.001)).toBe('no_speech')
  })

  it('fala no primeiro segundo não conta (fica fora da janela)', () => {
    const d = new SilenceDetector()
    expect(feed(d, 900, 0.3)).toBe('pending')
    expect(feed(d, 5200, 0.001)).toBe('no_speech')
  })

  it('fala dentro da janela vira speech e não muda mais', () => {
    const d = new SilenceDetector()
    feed(d, 1100, 0.001)
    expect(feed(d, 200, 0.2)).toBe('speech')
    expect(feed(d, 8000, 0)).toBe('speech')
  })

  it('ruído baixo abaixo do limiar não conta como fala', () => {
    const d = new SilenceDetector()
    expect(feed(d, 6200, 0.005)).toBe('no_speech')
  })
})
