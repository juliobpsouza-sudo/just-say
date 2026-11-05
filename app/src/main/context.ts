// Captura do contexto completo, fora do caminho crítico:
// começa no toque, em paralelo com a gravação.
//   1. app em foco + URL (≤ 400 ms);
//   2. as listas e a configuração decidem se o texto pode ser lido;
//   3. campo, cursor e entorno (até 500 ms do toque) e texto visível (até 1,5 s, em paralelo).
import { arch, release, uptime } from 'node:os'
import { app } from 'electron'
import { TIMING, LIMITS } from '../shared/constants'
import {
  buildFullAudioContext,
  type DeviceEnvironment,
  type RawAppCapture,
} from '../shared/audioContext'
import { contextPolicy, type ContextPolicy } from '../shared/contextLists'
import { captureApp, captureFocus } from './native/contextHelper'
import { wmiQuery } from './native/utilHelper'
import { practiceActiveApplication } from '../shared/onboarding'
import { practiceActive } from './onboarding'
import { settingsStore } from './settings'

/** Texto visível tem prazo próprio, maior: só é usado quando a pessoa termina de falar (D46). */
export const VISIBLE_TEXT_TIMEOUT_MS = 1500

/** Caracteres pedidos à DLL: ~4 por token, com folga para o corte por tokens depois. */
const CHARS_PER_TOKEN = 4

let devicePromise: Promise<DeviceEnvironment> | null = null

/** Ambiente do dispositivo. Fabricante e modelo vêm do WMI uma vez só. */
export async function deviceEnvironment(): Promise<DeviceEnvironment> {
  devicePromise ??= (async () => {
    let manufacturer: string | null = null
    let model: string | null = null
    try {
      const [cs] = await wmiQuery<{ Manufacturer: string | null; Model: string | null }>(
        'SELECT Manufacturer, Model FROM Win32_ComputerSystem',
      )
      manufacturer = cs?.Manufacturer ?? null
      model = cs?.Model ?? null
    } catch {
      // sem WMI: segue sem fabricante e modelo
    }
    return {
      os: 'windows',
      os_version: release(),
      arch: arch(),
      locale: app.getLocale(),
      region: app.getLocaleCountryCode(),
      manufacturer,
      model,
      uptime_s: 0,
    }
  })()
  const env = await devicePromise
  return { ...env, uptime_s: Math.round(uptime()) }
}

export interface FullContextResult {
  audioContext: Record<string, unknown>
  policy: ContextPolicy | null
  exeName: string | null
}

export async function captureFullContext(): Promise<FullContextResult> {
  const started = Date.now()
  const settings = settingsStore().store
  const deviceP = deviceEnvironment()

  const appCapture: RawAppCapture | null = await captureApp(TIMING.BROWSER_URL_TIMEOUT_MS, true)
  const policy = appCapture
    ? contextPolicy({
        exeName: appCapture.app.exeName,
        url: appCapture.browser?.url ?? null,
        readScreenContext: settings.readScreenContext,
        blockedApps: settings.contextBlockedApps,
        blockedSites: settings.contextBlockedSites,
      })
    : null

  // Mesmo sem ler o texto, os metadados do campo (editável? tipo?) servem para o cartão de copiar.
  const elapsed = Date.now() - started
  const focus = await captureFocus({
    timeoutMs: Math.max(100, TIMING.CONTEXT_TIMEOUT_MS - elapsed),
    visibleTimeoutMs: Math.max(100, VISIBLE_TEXT_TIMEOUT_MS - elapsed),
    cursorChars: LIMITS.RELATED_TEXT_BEFORE_TOKENS * CHARS_PER_TOKEN,
    visibleChars: LIMITS.VISIBLE_TEXT_TOKENS * CHARS_PER_TOKEN,
    surroundingChars: LIMITS.RELATED_TEXT_BEFORE_TOKENS * CHARS_PER_TOKEN,
    readText: !(policy?.blockScreen ?? false),
  })

  const audioContext = buildFullAudioContext({
    app: appCapture,
    focus,
    policy,
    device: await deviceP.catch(() => null),
    captureMs: Date.now() - started,
  })
  // Ditado de treino do passo a passo: o app em foco vira a conversa fictícia.
  if (practiceActive() && appCapture?.app.pid === process.pid)
    audioContext.active_application = { ...practiceActiveApplication(), pid: process.pid }

  return {
    audioContext,
    policy,
    exeName: appCapture?.app.exeName ?? null,
  }
}
