// Áudio no main: mudo dos outros apps, dispositivos e gravações salvas.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { StartSoundDelayMode } from '../shared/settings'
import {
  decideStartSoundDelay,
  type AudioRouteInfo,
  type StartSoundDecision,
} from '../shared/startSound'
import * as util from './native/utilHelper'

/** PIDs de todos os processos do Just Say: não são mutados (o som de início toca por eles). */
function ownPids(): number[] {
  return app.getAppMetrics().map((m) => m.pid)
}

export async function muteBackgroundAudio(): Promise<number> {
  return util.muteAudio(ownPids())
}

export async function unmuteBackgroundAudio(): Promise<number> {
  return util.unmuteAudio()
}

/**
 * Rota de áudio atual: o microfone (o escolhido, pelo nome que o Chromium mostra, ou o padrão
 * do Windows) e a saída padrão, se são o mesmo aparelho e se algum é Bluetooth.
 */
export async function audioRoute(micLabel: string | null): Promise<AudioRouteInfo> {
  const devices = await util.getAudioDevices()
  const captures = devices.filter((d) => d.flow === 'capture')
  const byLabel = micLabel
    ? captures.find((d) => d.name === micLabel || micLabel.includes(d.name) || d.name.includes(micLabel))
    : undefined
  const mic = byLabel ?? captures.find((d) => d.isDefault)
  const out = devices.find((d) => d.flow === 'render' && d.isDefault)
  const sameDevice = Boolean(mic?.containerId && out?.containerId && mic.containerId === out.containerId)
  return {
    micName: mic?.name ?? null,
    outputName: out?.name ?? null,
    sameDevice,
    bluetooth: Boolean(mic?.bluetooth || (sameDevice && out?.bluetooth)),
  }
}

export async function startSoundDecision(mode: StartSoundDelayMode, micLabel: string | null): Promise<StartSoundDecision> {
  try {
    return decideStartSoundDelay(mode, await audioRoute(micLabel))
  } catch {
    return decideStartSoundDelay(mode, { micName: null, outputName: null, sameDevice: false, bluetooth: false })
  }
}

export function recordingsDir(): string {
  return join(app.getPath('userData'), 'Recordings')
}

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/

/** Salva o WAV da sessão em userData/Recordings/<sessão>.wav. Devolve o caminho. */
export async function saveRecording(sessionId: string, wav: ArrayBuffer): Promise<string> {
  if (!SAFE_ID.test(sessionId)) throw new Error('id de sessão inválido')
  const dir = recordingsDir()
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${sessionId}.wav`)
  await writeFile(path, Buffer.from(wav))
  return path
}
