// Canais IPC. O preload só deixa passar o que está aqui.

export const IPC = {
  // main → renderers
  globalKeyboard: 'global-keyboard',
  settingsChanged: 'settings:changed',
  machineDisabledChanged: 'recording-machine:disabled-changed',
  machineStateBroadcast: 'recording-machine:state-broadcast',
  keyboardStatus: 'keyboard-input:status',
  hubNavigate: 'hub:navigate',

  // renderer → main (invoke)
  settingsGet: 'settings:get',
  settingsSetShortcut: 'settings:set-shortcut',
  settingsResetShortcuts: 'settings:reset-shortcuts',
  shortcutCaptureStart: 'shortcuts:capture-start',
  shortcutCaptureEnd: 'shortcuts:capture-end',
  machineGetDisabled: 'recording-machine:get-disabled',
  keyboardGetStatus: 'keyboard-input:get-status',
  keyboardResetPressing: 'keyboard-input:reset-pressing-keycodes',
  keyboardGetDeviceList: 'keyboard-input:get-keyboard-device-list',
  machineStateLog: 'recording-machine:state',
  insertText: 'keyboard-input:insert-text',
  insertRichText: 'keyboard-input:insert-rich-text',
  getSelectedText: 'focused-context:get-selected-text',
  getFocusedInputInfo: 'focused-context:get-focused-input-info',
  audioMute: 'audio:mute',
  audioUnmute: 'audio:unmute',
  audioIsMuted: 'audio:is-muted',
  audioGetDevices: 'audio:get-devices-async',
  audioStartSoundDecision: 'audio:start-sound-decision',
  audioLidOpen: 'audio:is-lid-open',
  settingsSet: 'settings:set',
  audioSaveRecording: 'audio:save-recording',
  aiVoiceFlow: 'audio:ai-voice-flow',
  abortAiVoiceFlow: 'audio:abort-ai-voice-flow-request',
  serverHealth: 'server:health',
  providersGet: 'server:get-providers',
  providersSet: 'server:set-providers',
  providersUnblock: 'server:unblock-provider',
  lastVoiceFlowGet: 'voice-flow:get-last',
  lastVoiceFlowRetry: 'voice-flow:retry-last',
  lastVoiceFlowBroadcast: 'voice-flow:last',
  usageGet: 'server:get-usage',
  usageChanged: 'usage:changed',
  barNotice: 'floating-bar-alert',
  getFullContext: 'focused-context:get-full-context',
  copyCardText: 'copy-card:text',
  copyCardGetText: 'copy-card:get-text',
  copyCardCopy: 'copy-card:copy',
  copyCardClose: 'copy-card:close',
  copyCardShow: 'copy-card:show',
  // Chave do Groq de cada pessoa (D95)
  groqKeyStatus: 'groq-key:status',
  groqKeyTest: 'groq-key:test',
  groqKeySave: 'groq-key:save',
  groqKeyRemove: 'groq-key:remove',
  // Atualização pelo botão (D99)
  updateGet: 'update:get',
  updateCheck: 'update:check',
  updateApply: 'update:apply',
  updateChanged: 'update:changed',
  /** Copia um texto pelo main (o renderer não tem permissão de área de transferência, D91). */
  clipboardWriteText: 'clipboard:write-text',
  /** Só em desenvolvimento: mostra o cartão sem colar nada (teste). */
  debugShowCopyCard: 'debug:show-copy-card',
  // Just Ask (Fase 6)
  answerCardShow: 'page:open-interactive-card',
  answerCardData: 'interactive-card:data',
  answerCardGet: 'interactive-card:get-data',
  answerCardCopy: 'interactive-card:copy',
  answerCardClose: 'interactive-card:close',
  openExternalUrl: 'page:open-external-url',
  // Fase 7: histórico, dicionário, estilo pessoal e passo a passo
  historyList: 'db:history-list',
  historyDelete: 'db:history-delete',
  historyDeleteAll: 'db:history-delete-all',
  historyRetry: 'db:history-retry',
  historyAudio: 'db:history-audio',
  historyChanged: 'db:history-changed',
  dictionaryList: 'dictionary:list',
  dictionaryAdd: 'dictionary:add',
  dictionaryUpdate: 'dictionary:update',
  dictionaryDelete: 'dictionary:delete',
  dictionaryImportCsv: 'file:pick-and-parse-dictionary-csv',
  dictionaryChanged: 'dictionary:changed',
  styleGet: 'personal-style:get',
  styleSetEnabled: 'personal-style:set-enabled',
  styleRebuild: 'personal-style:rebuild',
  styleReset: 'personal-style:reset',
  onboardingGet: 'onboarding:get',
  onboardingSet: 'onboarding:set',
  onboardingPractice: 'onboarding:practice',
  notionGet: 'integrations:notion-get',
  notionRefresh: 'integrations:notion-refresh',
  notionSetDefault: 'integrations:notion-set-default',
  // Estatísticas (D75)
  statsGet: 'stats:get',
  statsReset: 'stats:reset',

  // renderer → main (send)
  floatingBarVisible: 'page:set-floating-bar-visible',
  floatingBarInteractive: 'page:set-floating-bar-interactive',
  barNoticeAction: 'floating-bar-alert:action',
  typeTranscript: 'keyboard:type-transcript',
  openHub: 'page:open-hub',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export const IPC_ALLOWED: readonly string[] = Object.values(IPC)

/** Retrato do teclado que o main repassa (formato do KeyboardHelper.dll). */
export interface KeyboardSnapshot {
  seq: number
  time: number
  type: 'down' | 'up' | 'reset' | 'watcher'
  key: string
  swallowed: boolean
  pressingKeys: string[]
}

export interface KeyboardStatus {
  state: 'starting' | 'running' | 'restarting' | 'failed' | 'stopped'
  restarts: number
  lastError: string | null
}

export interface MachineStateReport {
  value: string
  event: string
  sessionId: string | null
  mode: string | null
  at: number
  detail?: Record<string, unknown>
}

/** Aviso na barra (uso gratuito, dicionário, dica de uso). A ação vira um botão no aviso. */
export interface BarNotice {
  text: string
  action?: { label: string; id: string }
  /** Mais de um botão (ex.: Abrir e Desfazer). */
  actions?: { label: string; id: string }[]
}

/** Botões de um aviso, juntando `action` e `actions`. */
export function noticeActions(n: BarNotice): { label: string; id: string }[] {
  return [...(n.action ? [n.action] : []), ...(n.actions ?? [])]
}
