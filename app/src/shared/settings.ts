// Store `app-settings` com as chaves e os padrões.
import { DEFAULT_BLOCKED_APPS, DEFAULT_BLOCKED_SITES } from './contextLists'
import { DEFAULT_TRANSLATION_TARGETS, isKnownLanguage, isValidDictationLanguages, isValidTargetList } from './languages'
import { HISTORY_RETENTION_OPTIONS } from './history'
import { DEFAULT_SHORTCUTS, type ShortcutBindings } from './shortcuts'
import { DEFAULT_TYPING_WPM, MAX_TYPING_WPM, MIN_TYPING_WPM } from './stats'

export type AppearancePreference = 'light' | 'dark' | null

export interface AppSettings {
  featureShortcutBindings: ShortcutBindings
  microphoneDevices: { deviceId: string; label: string }[]
  selectedMicrophoneDevice: string | null
  preferredBuiltInMicId: string | null
  preferredLanguage: string
  autoSelectLanguages: boolean
  selectedLanguages: string[]
  translationModeTargetLanguageCodes: string[]
  translationModeAlertPreferredLanguageCode: string | null
  launchAtSystemStartup: boolean
  showFlowBarOnDesktop: boolean
  enableInteractionSoundEffects: boolean
  /** Só faz sentido no macOS; mantido por paridade. */
  enableShowAppInDock: boolean
  historyDurationSeconds: number
  enabledMuteBackgroundAudio: boolean
  enabledOpusCompression: boolean
  dynamicMicrophoneDegradationEnabled: boolean
  gpuSandboxDisabled: boolean
  appearancePreference: AppearancePreference
  /** Endereço do backend próprio. Vazio = padrão local. */
  __DEV_API_HOST: string

  // ---------- extensões do Just Say (adicionadas depois) ----------
  /** Atraso de 1,2 s no som de início: automático (só fone Bluetooth), sempre ou nunca. */
  startSoundDelayMode: StartSoundDelayMode
  /** Ler o texto da tela e do campo para o refino (Fase 5). */
  readScreenContext: boolean
  /** Apps (exe) e sites (domínio) onde o texto da tela nunca é lido. */
  contextBlockedApps: string[]
  contextBlockedSites: string[]
  /** Migração: a lista de idiomas da tradução já recebeu o inglês padrão (D58). */
  __COMPATIBLE_translationDefaultTargets: boolean
  /** Aprender com as correções feitas depois de colar. */
  editLearningEnabled: boolean
  /** Dica "que tal ditar?" para quem digita muito. */
  typingHintEnabled: boolean
  typingHintLastShownAt: number | null
  /** Velocidade de digitação da pessoa, para o "tempo economizado" (D75). */
  statsTypingWpm: number
  /** Mostra no Painel o monitor ao vivo e as transições, ferramentas de teste. */
  showTechnicalMonitor: boolean
  /** Depois de colar, deixar o texto ditado no Ctrl+C (D98). Desligado: volta o clipboard antigo e o texto fica fora do Win+V. */
  keepTranscriptInClipboard: boolean
}

const isStringList = (v: unknown) =>
  Array.isArray(v) && v.length <= 300 && v.every((s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 100)

export type StartSoundDelayMode = 'auto' | 'always' | 'never'

/** Chaves que o Hub pode mudar pelo `settings:set`, com o validador de cada uma. */
export const EDITABLE_SETTINGS = {
  enableInteractionSoundEffects: (v: unknown) => typeof v === 'boolean',
  enabledMuteBackgroundAudio: (v: unknown) => typeof v === 'boolean',
  startSoundDelayMode: (v: unknown) => v === 'auto' || v === 'always' || v === 'never',
  readScreenContext: (v: unknown) => typeof v === 'boolean',
  contextBlockedApps: isStringList,
  contextBlockedSites: isStringList,
  translationModeTargetLanguageCodes: isValidTargetList,
  translationModeAlertPreferredLanguageCode: (v: unknown) => v === null || isKnownLanguage(v),
  historyDurationSeconds: (v: unknown) => HISTORY_RETENTION_OPTIONS.some((o) => o.seconds === v),
  autoSelectLanguages: (v: unknown) => typeof v === 'boolean',
  selectedLanguages: isValidDictationLanguages,
  selectedMicrophoneDevice: (v: unknown) => v === null || (typeof v === 'string' && v.length > 0 && v.length <= 300),
  editLearningEnabled: (v: unknown) => typeof v === 'boolean',
  typingHintEnabled: (v: unknown) => typeof v === 'boolean',
  appearancePreference: (v: unknown) => v === null || v === 'light' || v === 'dark',
  showTechnicalMonitor: (v: unknown) => typeof v === 'boolean',
  keepTranscriptInClipboard: (v: unknown) => typeof v === 'boolean',
  launchAtSystemStartup: (v: unknown) => typeof v === 'boolean',
  statsTypingWpm: (v: unknown) => Number.isInteger(v) && (v as number) >= MIN_TYPING_WPM && (v as number) <= MAX_TYPING_WPM,
} satisfies Partial<Record<keyof AppSettings, (v: unknown) => boolean>>

export type EditableSettingKey = keyof typeof EDITABLE_SETTINGS

export const DEFAULT_SETTINGS: AppSettings = {
  featureShortcutBindings: DEFAULT_SHORTCUTS,
  microphoneDevices: [],
  selectedMicrophoneDevice: null,
  preferredBuiltInMicId: null,
  preferredLanguage: '',
  autoSelectLanguages: false,
  selectedLanguages: [],
  translationModeTargetLanguageCodes: [...DEFAULT_TRANSLATION_TARGETS],
  translationModeAlertPreferredLanguageCode: null,
  launchAtSystemStartup: true,
  showFlowBarOnDesktop: false,
  enableInteractionSoundEffects: true,
  enableShowAppInDock: true,
  historyDurationSeconds: -1,
  enabledMuteBackgroundAudio: true,
  enabledOpusCompression: true,
  dynamicMicrophoneDegradationEnabled: false,
  gpuSandboxDisabled: false,
  appearancePreference: null,
  __DEV_API_HOST: '',
  startSoundDelayMode: 'auto',
  readScreenContext: true,
  contextBlockedApps: [...DEFAULT_BLOCKED_APPS],
  contextBlockedSites: [...DEFAULT_BLOCKED_SITES],
  __COMPATIBLE_translationDefaultTargets: false,
  editLearningEnabled: true,
  typingHintEnabled: true,
  typingHintLastShownAt: null,
  statsTypingWpm: DEFAULT_TYPING_WPM,
  showTechnicalMonitor: false,
  keepTranscriptInClipboard: true,
}
