import { describe, expect, it } from 'vitest'
import { hasSpeechEnergy, loudWindows, readPcm16Wav } from '../src/audioLevel.ts'

/** WAV PCM 16 bits mono a 16 kHz, com `fn(segundos)` dando a amostra entre -1 e 1. */
function wav(seconds: number, fn: (t: number) => number, sampleRate = 16000): Buffer {
  const n = Math.round(seconds * sampleRate)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, fn(i / sampleRate))) * 32767), i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

const dB = (v: number) => 10 ** (v / 20)
const tone = (amp: number) => (t: number) => amp * Math.sin(2 * Math.PI * 220 * t)

describe('detector de silêncio (D88)', () => {
  it('silêncio total (só zeros) não tem fala', () => {
    expect(hasSpeechEnergy(wav(1.6, () => 0))).toBe(false)
  })

  it('chiado bem baixo (-60 dB) também não', () => {
    expect(hasSpeechEnergy(wav(1.3, tone(dB(-57))))).toBe(false)
  })

  it('fala baixa (-40 dB) passa, mesmo curta', () => {
    expect(hasSpeechEnergy(wav(0.3, tone(dB(-37))))).toBe(true)
  })

  it('um estalo de 30 ms sozinho não basta; 3 trechos com som bastam', () => {
    const click = wav(1, (t) => (t < 0.03 ? 0.3 : 0))
    expect(loudWindows(readPcm16Wav(click)!)).toBe(1)
    expect(hasSpeechEnergy(click)).toBe(false)
    expect(hasSpeechEnergy(wav(1, (t) => (t < 0.09 ? 0.3 * Math.sin(2 * Math.PI * 220 * t) : 0)))).toBe(true)
  })

  it('formato que não é WAV PCM 16 bits: não sabe medir (manda ao STT como sempre)', () => {
    expect(hasSpeechEnergy(Buffer.from('OggS qualquer coisa'))).toBeNull()
    const float = wav(0.5, () => 0); float.writeUInt16LE(3, 20) // formato 3 = float
    expect(hasSpeechEnergy(float)).toBeNull()
  })
})
