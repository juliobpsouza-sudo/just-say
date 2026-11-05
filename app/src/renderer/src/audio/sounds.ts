// Sons de interação, sintetizados (sem arquivos de áudio). Tons próprios do Just Say.
type Note = { freq: number; ms: number }

const VOLUME = 0.12

const SOUNDS = {
  start: [
    { freq: 587, ms: 70 },
    { freq: 880, ms: 90 },
  ],
  stop: [
    { freq: 880, ms: 70 },
    { freq: 587, ms: 90 },
  ],
  cancel: [{ freq: 330, ms: 140 }],
} satisfies Record<string, Note[]>

export type SoundName = keyof typeof SOUNDS

let ctx: AudioContext | null = null

export function playSound(name: SoundName, delayMs = 0): () => void {
  const timer = setTimeout(() => {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    let t = ctx.currentTime + 0.01
    for (const note of SOUNDS[name]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const dur = note.ms / 1000
      osc.type = 'sine'
      osc.frequency.value = note.freq
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(VOLUME, t + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + dur + 0.02)
      t += dur
    }
  }, delayMs)
  return () => clearTimeout(timer)
}

/**
 * Nome do microfone escolhido nas configurações (como o Chromium mostra), para o main achar
 * o mesmo aparelho na lista do Windows. null = microfone padrão do sistema.
 */
export async function selectedMicLabel(micDeviceId: string | null): Promise<string | null> {
  if (!micDeviceId || micDeviceId === 'default') return null
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.find((d) => d.kind === 'audioinput' && d.deviceId === micDeviceId)?.label || null
  } catch {
    return null
  }
}
