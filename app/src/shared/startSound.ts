// Atraso do som de início: atrasa 1,2 s quando o
// microfone e a saída são o mesmo aparelho. O motivo é o fone Bluetooth, que troca para o
// "modo chamada" ao abrir o microfone e corta o começo do som. Fone USB ou com fio não
// precisa. Ver DECISOES D45.
import { TIMING } from './constants'
import type { StartSoundDelayMode } from './settings'

export interface AudioRouteInfo {
  micName: string | null
  outputName: string | null
  /** Microfone e saída no mesmo aparelho físico. */
  sameDevice: boolean
  /** Algum dos dois é Bluetooth. */
  bluetooth: boolean
}

export interface StartSoundDecision extends AudioRouteInfo {
  mode: StartSoundDelayMode
  delayMs: number
}

export function decideStartSoundDelay(mode: StartSoundDelayMode, route: AudioRouteInfo): StartSoundDecision {
  const delay = TIMING.START_SOUND_DELAY_SAME_DEVICE_MS
  const delayMs = mode === 'always' ? delay : mode === 'never' ? 0 : route.sameDevice && route.bluetooth ? delay : 0
  return { ...route, mode, delayMs }
}

/** Frase para a tela de Configurações → Áudio. */
export function describeDecision(d: StartSoundDecision): string {
  const device = d.micName ?? 'microfone padrão'
  const kind = d.bluetooth ? 'Bluetooth' : 'USB ou com fio'
  const timing = d.delayMs > 0 ? `atraso de ${(d.delayMs / 1000).toLocaleString('pt-BR')} s` : 'sem atraso'
  if (d.mode === 'always') return `Sempre atrasar: ${timing}.`
  if (d.mode === 'never') return 'Nunca atrasar: o som toca na hora.'
  return `Detectado: ${device} (${kind}${d.sameDevice ? ', mesmo aparelho da saída' : ''}) → ${timing}.`
}
