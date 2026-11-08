// Processo main do Just Say.
import { join } from 'node:path'
import { app, clipboard, ClipboardItem, ipcMain, Menu, nativeImage, nativeTheme, powerMonitor, session, shell, Tray } from 'electron'
import { IPC, type KeyboardSnapshot, type MachineStateReport } from '../shared/ipc'
import {
  SHORTCUT_FEATURES,
  comboLabel,
  targetShortcutList,
  type ShortcutFeature,
} from '../shared/shortcuts'
import {
  startSoundDecision,
  muteBackgroundAudio,
  saveRecording,
  unmuteBackgroundAudio,
} from './audio'
import * as insertion from './insertion'
import { KeyboardRelay } from './keyboard/relay'
import { getCurrentInputState } from './native/inputHelper'
import { deviceIsLidOpen, getAudioDevices, isMutedByUs } from './native/utilHelper'
import { abortVoiceFlow, getProviders, getUsage, serverHealth, setProviders, unblockProvider } from './server/client'
import { ensureLocalServer, stopLocalServer } from './server/localServer'
import { lastVoiceFlow, retryLastVoiceFlow, runVoiceFlow, setLastVoiceFlowListener } from './voiceFlowService'
import { EDITABLE_SETTINGS, type EditableSettingKey } from '../shared/settings'
import { usageSummary, type UsageReport } from '../shared/usage'
import type { VoiceFlowRequest, VoiceFlowResult } from '../shared/voiceFlow'
import { KeyboardSupervisor } from './keyboard/supervisor'
import { groqKeyStatus, pushGroqKeyToServer, removeGroqKey, saveGroqKey, testGroqKey } from './apiKeys'
import { logRecordingEvent, recordingLogDir } from './logs'
import { nativeDllPath, resourcePath, runningFromProject } from './paths'
import { getSettings, getShortcuts, resetShortcuts, setShortcut, settingsStore } from './settings'
import { captureFullContext, deviceEnvironment } from './context'
import {
  allWindows,
  answerCardPayload,
  closeAnswerCard,
  closeCopyCard,
  copyCardText,
  createFloatingBar,
  hubWindow,
  markQuitting,
  openHub,
  setFloatingBarInteractive,
  setFloatingBarVisible,
  showAnswerCard,
  showCopyCard,
  type AnswerCardPayload,
} from './windows'
import { safeExternalUrl } from '../shared/urls'
import { applyRetention, closeHistory, setHistoryChangedListener } from './history/historyService'
import { registerPhase7Ipc } from './ipcPhase7'
import { onKeySnapshot, refreshStyleIfDue, showBarNotice, trackInsertion } from './learning'
import { onboardingState } from './onboarding'

// Antes de tudo: define a pasta userData como %APPDATA%\Just Say.
// JUST_SAY_PROFILE: uma segunda cópia com pasta de dados própria, para testar ao lado (D95).
const PROFILE = process.env.JUST_SAY_PROFILE?.trim()
app.setName(PROFILE ? `Just Say (${PROFILE})` : 'Just Say')
app.setAppUserModelId('com.justsay.desktop')

const SILENT_LAUNCH_FLAG = '--system-startup-silent-launch'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (settingsStore().get('gpuSandboxDisabled')) app.commandLine.appendSwitch('no-sandbox')
  app.on('second-instance', () => openHub())
  app.whenReady().then(bootstrap)
}

let keyboard: KeyboardSupervisor | null = null
let tray: Tray | null = null
let recordingActive = false
let capturingShortcut = false
let lastMachineState = 'idle'

function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of allWindows()) win.webContents.send(channel, ...args)
}

/** Lista de atalhos que o hook reconhece. O Escape só entra durante a gravação. */
function applyTargetShortcuts(): void {
  if (!keyboard) return
  keyboard.updateTargetShortcuts(capturingShortcut ? [] : targetShortcutList(getShortcuts(), recordingActive))
}

function applyLoginItem(): void {
  const openAtLogin = settingsStore().get('launchAtSystemStartup')
  if (!runningFromProject()) {
    app.setLoginItemSettings({ openAtLogin, args: [SILENT_LAUNCH_FLAG] })
    return
  }
  // Da pasta do projeto (D81, D96): registra o executável que abriu o app, com a pasta do app.
  // Vale para o "Just Say.exe" do atalho da Área de Trabalho (D74) e para o electron.exe do
  // "Abrir Just Say.cmd". No `npm run dev` não: lá o app depende do servidor do Vite, que
  // não estaria rodando no login. O nome do registro é o do app, então um perfil de teste
  // (JUST_SAY_PROFILE) não mexe no registro do app principal.
  if (process.env.ELECTRON_RENDERER_URL) return
  app.setLoginItemSettings({
    openAtLogin,
    name: app.getName(),
    path: process.execPath,
    args: [app.getAppPath(), SILENT_LAUNCH_FLAG],
  })
}

function startKeyboard(): void {
  const childScript = join(import.meta.dirname, 'keyboard-child.js')
  keyboard = new KeyboardSupervisor(childScript, nativeDllPath('KeyboardHelper.dll'))
  const relay = new KeyboardRelay((snapshot: KeyboardSnapshot) => broadcast(IPC.globalKeyboard, snapshot))
  keyboard.on('keys', (snapshot) => {
    relay.push(snapshot)
    onKeySnapshot(snapshot, recordingActive)
  })
  keyboard.on('status', (status) => {
    console.log(`[teclado] status=${status.state} reinícios=${status.restarts}`)
    broadcast(IPC.keyboardStatus, status)
    updateTray()
  })
  keyboard.on('log', (line) => console.log(line))
  applyTargetShortcuts()
  keyboard.start()

  // Depois de suspender ou bloquear a tela, teclas podem ter ficado "presas".
  powerMonitor.on('resume', () => keyboard?.resetPressingKeycodes())
  powerMonitor.on('unlock-screen', () => keyboard?.resetPressingKeycodes())
}

function updateTray(): void {
  if (!tray) return
  const shortcuts = getShortcuts()
  const status = keyboard?.status
  const keyboardLine =
    status?.state === 'running'
      ? 'Teclado: ativo'
      : status?.state === 'failed'
        ? 'Teclado: parou (reinicie o app)'
        : 'Teclado: iniciando…'
  const usageLine = usageSummary(latestUsage)
  tray.setToolTip(`Just Say — ${comboLabel(shortcuts.dictation)} para ditar\n${usageLine}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Ditado: ${comboLabel(shortcuts.dictation)}`, enabled: false },
      { label: `Just Ask: ${comboLabel(shortcuts.askAnything)}`, enabled: false },
      { label: `Tradução: ${comboLabel(shortcuts.translation)}`, enabled: false },
      { label: keyboardLine, enabled: false },
      { label: `Uso gratuito: ${usageLine}`, enabled: false },
      { type: 'separator' },
      {
        label: 'Ler o contexto da tela',
        type: 'checkbox',
        checked: settingsStore().get('readScreenContext'),
        click: (item) => {
          settingsStore().set('readScreenContext', item.checked)
          broadcast(IPC.settingsChanged, getSettings())
        },
      },
      { type: 'separator' },
      { label: 'Abrir o Just Say', click: () => openHub('/dashboard') },
      { label: 'Trocar atalhos…', click: () => openHub('/settings') },
      { label: 'Abrir pasta de logs', click: () => void shell.openPath(recordingLogDir()) },
      { type: 'separator' },
      { label: 'Sair', click: () => app.quit() },
    ]),
  )
}

// ---------- uso gratuito ----------

let latestUsage: UsageReport | null = null
const USAGE_POLL_MS = 60_000
const HISTORY_RETENTION_CHECK_MS = 3_600_000

async function refreshUsage(): Promise<UsageReport | null> {
  latestUsage = await getUsage()
  broadcast(IPC.usageChanged, latestUsage)
  updateTray()
  return latestUsage
}

/** Depois de cada ditado: avisos de limite na barra e uso atualizado. */
function afterVoiceFlow(result: VoiceFlowResult): VoiceFlowResult {
  if (result.ok) for (const text of result.data.notices ?? []) showBarNotice({ text })
  refreshStyleIfDue(result)
  void refreshUsage()
  return result
}

/**
 * Resultado da colagem no log do ditado (D91): se colou, o código do InputHelper, em qual app
 * e se o cartão de copiar apareceu. Nunca o texto, só o tamanho.
 */
async function logInsertion(
  sessionId: string | undefined,
  kind: 'texto' | 'rico',
  result: { ok: boolean; code: number },
  chars: number,
  copyCard: boolean,
  started: number,
): Promise<void> {
  if (!sessionId) return
  const target = await getCurrentInputState().catch(() => null)
  logRecordingEvent(sessionId, {
    event: 'INSERT',
    kind,
    ok: result.ok,
    code: result.code,
    chars,
    copyCard,
    exe: target?.exeName ?? null,
    ms: Date.now() - started,
  })
}

function registerIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  registerPhase7Ipc({ afterVoiceFlow, hubWindow })

  ipcMain.handle(IPC.settingsSetShortcut, (_e, feature: ShortcutFeature, keys: string[]) => {
    if (!SHORTCUT_FEATURES.includes(feature) || !Array.isArray(keys)) return ['Pedido inválido.']
    const errors = setShortcut(feature, keys)
    if (errors.length === 0) {
      applyTargetShortcuts()
      broadcast(IPC.settingsChanged, getSettings())
      updateTray()
    }
    return errors
  })

  ipcMain.handle(IPC.settingsResetShortcuts, () => {
    resetShortcuts()
    applyTargetShortcuts()
    broadcast(IPC.settingsChanged, getSettings())
    updateTray()
    return getSettings()
  })

  // Enquanto o usuário grava um atalho novo, a máquina fica desligada e o hook não engole nada.
  const endCapture = () => {
    if (!capturingShortcut) return
    capturingShortcut = false
    applyTargetShortcuts()
    broadcast(IPC.machineDisabledChanged, false)
  }
  ipcMain.handle(IPC.shortcutCaptureStart, (e) => {
    capturingShortcut = true
    applyTargetShortcuts()
    broadcast(IPC.machineDisabledChanged, true)
    // Janela fechada no meio da captura: não deixa a máquina desligada.
    e.sender.once('destroyed', endCapture)
  })
  ipcMain.handle(IPC.shortcutCaptureEnd, endCapture)
  ipcMain.handle(IPC.machineGetDisabled, () => capturingShortcut)

  ipcMain.handle(IPC.keyboardGetStatus, () => keyboard?.status ?? null)
  ipcMain.handle(IPC.keyboardResetPressing, () => keyboard?.resetPressingKeycodes())
  ipcMain.handle(IPC.keyboardGetDeviceList, () => keyboard?.getKeyboardDeviceList() ?? [])

  ipcMain.handle(IPC.machineStateLog, (_e, report: MachineStateReport) => {
    lastMachineState = report.value
    const active = report.value.startsWith('recording_active')
    if (active !== recordingActive) {
      recordingActive = active
      applyTargetShortcuts()
    }
    if (report.sessionId) logRecordingEvent(report.sessionId, { ...report })
    broadcast(IPC.machineStateBroadcast, report)
  })

  // ---------- inserção e seleção ----------
  ipcMain.handle(
    IPC.insertText,
    async (
      _e,
      text: string,
      opts?: { remember?: boolean; showCopyCard?: boolean; copyText?: string; trackSessionId?: string; sessionId?: string },
    ) => {
      if (typeof text !== 'string' || !text) return { ok: false, code: 0 }
      const started = Date.now()
      const result = await insertion.insertText(text, { remember: Boolean(opts?.remember) })
      if (!result.ok) console.error(`[inserir] InputHelper devolveu ${result.code}`)
      void logInsertion(opts?.sessionId, 'texto', result, text.length, Boolean(opts?.showCopyCard || !result.ok), started)
      // Aprendizado por edição: observa o campo depois de colar.
      if (result.ok && typeof opts?.trackSessionId === 'string' && !opts.showCopyCard) trackInsertion(opts.trackSessionId, text)
      // Campo que não parece editável: cola mesmo assim e oferece copiar.
      if (opts?.showCopyCard || !result.ok) showCopyCard(typeof opts?.copyText === 'string' ? opts.copyText : text)
      return result
    },
  )
  ipcMain.handle(IPC.getFullContext, () => captureFullContext())
  ipcMain.handle(IPC.copyCardGetText, () => copyCardText())
  ipcMain.on(IPC.copyCardCopy, () => clipboard.writeText(copyCardText()))
  ipcMain.on(IPC.copyCardClose, () => closeCopyCard())
  // ---------- chave do Groq (D95): o renderer nunca recebe a chave, só o status ----------
  ipcMain.handle(IPC.groqKeyStatus, () => groqKeyStatus())
  ipcMain.handle(IPC.groqKeyTest, (_e, key: unknown) => testGroqKey(String(key ?? '')))
  ipcMain.handle(IPC.groqKeySave, (_e, key: unknown) => saveGroqKey(String(key ?? '')))
  ipcMain.handle(IPC.groqKeyRemove, () => removeGroqKey())
  ipcMain.handle(IPC.clipboardWriteText, (_e, text: unknown) => {
    if (typeof text !== 'string' || !text) return false
    clipboard.writeText(text.slice(0, 1_000_000))
    return true
  })
  if (runningFromProject()) ipcMain.handle(IPC.debugShowCopyCard, (_e, text: string) => showCopyCard(String(text)))
  // Tradução que falhou: oferece copiar a fala original, sem colar nada (D56).
  ipcMain.handle(IPC.copyCardShow, (_e, text: unknown) => {
    if (typeof text === 'string' && text.trim()) showCopyCard(text.slice(0, 100_000))
  })
  ipcMain.handle(
    IPC.insertRichText,
    async (
      _e,
      html: string,
      text: string,
      markdown: string | null,
      opts?: { remember?: boolean; showCopyCard?: boolean; sessionId?: string },
    ) => {
      if (typeof text !== 'string' || !text) return { ok: false, code: 0 }
      const started = Date.now()
      const result = await insertion.insertRichText(String(html), text, markdown == null ? null : String(markdown), {
        remember: Boolean(opts?.remember),
      })
      if (!result.ok) console.error(`[inserir rico] InputHelper devolveu ${result.code}`)
      void logInsertion(opts?.sessionId, 'rico', result, text.length, Boolean(opts?.showCopyCard || !result.ok), started)
      if (opts?.showCopyCard || !result.ok) showCopyCard(text)
      return result
    },
  )
  ipcMain.handle(IPC.getSelectedText, () => insertion.getSelectedText())

  // ---------- Just Ask: cartão de resposta e links ----------
  ipcMain.handle(IPC.answerCardShow, (_e, payload: unknown) => {
    const card = toAnswerCardPayload(payload)
    if (card) showAnswerCard(card)
    return Boolean(card)
  })
  ipcMain.handle(IPC.answerCardGet, () => answerCardPayload())
  ipcMain.on(IPC.answerCardCopy, (_e, content: { text?: unknown; html?: unknown }) => {
    if (typeof content?.text !== 'string') return
    const item: Record<string, string> = { 'text/plain': content.text }
    if (typeof content.html === 'string') item['text/html'] = content.html
    void clipboard.write([new ClipboardItem(item)]).catch((err) => console.error('[cartão] falha ao copiar', err))
  })
  ipcMain.on(IPC.answerCardClose, () => closeAnswerCard())
  // Só http/https: o link vem do modelo ou de uma página da web (D59).
  ipcMain.handle(IPC.openExternalUrl, async (_e, url: unknown) => {
    const safe = safeExternalUrl(url)
    if (!safe) return false
    await shell.openExternal(safe)
    return true
  })
  ipcMain.handle(IPC.getFocusedInputInfo, () => getCurrentInputState().catch(() => null))

  // ---------- áudio ----------
  ipcMain.handle(IPC.audioMute, () => {
    if (!settingsStore().get('enabledMuteBackgroundAudio')) return 0
    return muteBackgroundAudio().catch((err) => {
      console.error('[áudio] falha ao mutar', err)
      return 0
    })
  })
  ipcMain.handle(IPC.audioUnmute, () => unmuteBackgroundAudio().catch(() => 0))
  ipcMain.handle(IPC.audioIsMuted, () => isMutedByUs())
  ipcMain.handle(IPC.audioLidOpen, () => deviceIsLidOpen().catch(() => -1))
  ipcMain.handle(IPC.audioGetDevices, () => getAudioDevices().catch(() => []))
  ipcMain.handle(IPC.audioStartSoundDecision, (_e, micLabel: string | null) =>
    startSoundDecision(settingsStore().get('startSoundDelayMode'), typeof micLabel === 'string' ? micLabel : null),
  )

  // Configurações simples do Hub (só as chaves de EDITABLE_SETTINGS, com validação).
  ipcMain.handle(IPC.settingsSet, (_e, key: string, value: unknown) => {
    const validate = (EDITABLE_SETTINGS as Record<string, (v: unknown) => boolean>)[key]
    if (!validate || !validate(value)) return { ok: false, settings: getSettings() }
    settingsStore().set(key as EditableSettingKey, value as never)
    if (key === 'appearancePreference') applyAppearance()
    if (key === 'launchAtSystemStartup') applyLoginItem()
    broadcast(IPC.settingsChanged, getSettings())
    updateTray()
    return { ok: true, settings: getSettings() }
  })
  ipcMain.handle(IPC.audioSaveRecording, (_e, sessionId: string, wav: ArrayBuffer) => saveRecording(sessionId, wav))

  // ---------- servidor ----------
  ipcMain.handle(IPC.serverHealth, () => serverHealth())
  ipcMain.handle(IPC.aiVoiceFlow, async (_e, req: VoiceFlowRequest) => afterVoiceFlow(await runVoiceFlow(req)))
  ipcMain.handle(IPC.abortAiVoiceFlow, (_e, requestId: string) => abortVoiceFlow(String(requestId)))
  ipcMain.handle(IPC.providersGet, () => getProviders())
  ipcMain.handle(IPC.providersSet, (_e, settings: unknown) => setProviders(settings))
  ipcMain.handle(IPC.providersUnblock, (_e, id: string) => unblockProvider(String(id)))
  ipcMain.handle(IPC.lastVoiceFlowGet, () => lastVoiceFlow())
  ipcMain.handle(IPC.lastVoiceFlowRetry, async () => {
    const result = afterVoiceFlow(await retryLastVoiceFlow())
    // Refazer uma pergunta do Just Ask mostra a resposta de novo no cartão.
    if (result.ok && result.data.delivery === 'reply')
      showAnswerCard({
        question: result.data.user_prompt ?? '',
        answer: result.data.refine_text,
        sources: result.data.web_metadata?.sources ?? [],
      })
    return result
  })
  ipcMain.handle(IPC.usageGet, () => refreshUsage())

  ipcMain.on(IPC.floatingBarVisible, (_e, visible: boolean) => setFloatingBarVisible(Boolean(visible)))
  ipcMain.on(IPC.floatingBarInteractive, (_e, interactive: boolean) => setFloatingBarInteractive(Boolean(interactive)))
  ipcMain.on(IPC.typeTranscript, () => {
    if (!insertion.pasteLastTranscript()) console.log('[colar última transcrição] ainda não há transcrição')
  })
  ipcMain.on(IPC.openHub, (_e, route?: string) => openHub(route))
}

/**
 * Tema (`appearancePreference`): null segue o Windows. O `nativeTheme` muda o
 * `prefers-color-scheme` de todas as janelas do app de uma vez.
 */
function applyAppearance(): void {
  nativeTheme.themeSource = settingsStore().get('appearancePreference') ?? 'system'
}

/** Valida o que a barra manda para o cartão de resposta. */
function toAnswerCardPayload(value: unknown): AnswerCardPayload | null {
  const v = (value ?? {}) as Record<string, unknown>
  if (typeof v.answer !== 'string' || !v.answer.trim()) return null
  const sources = Array.isArray(v.sources) ? (v.sources as { title?: unknown; url?: unknown }[]) : []
  return {
    question: typeof v.question === 'string' ? v.question.slice(0, 2000) : '',
    answer: v.answer.slice(0, 100_000),
    sources: sources
      .map((s) => ({ title: typeof s?.title === 'string' ? s.title.slice(0, 300) : '', url: safeExternalUrl(s?.url) }))
      .filter((s): s is { title: string; url: string } => s.url !== null)
      .slice(0, 10),
  }
}

/** Nenhuma janela do app navega para fora nem abre janelas novas (os links vão pelo IPC). */
function lockNavigation(): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', (e, url) => {
      if (!(url.startsWith('file://') || (devUrl && url.startsWith(devUrl)))) e.preventDefault()
    })
  })
}

/** Microfone liberado só para as páginas do próprio app. */
function allowMicrophoneForOwnPages(): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const isOwn = (url: string) => url.startsWith('file://') || (devUrl ? url.startsWith(devUrl) : false)
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) =>
    callback(permission === 'media' && isOwn(wc.getURL())),
  )
  session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media' && isOwn(wc?.getURL() ?? ''))
}

function bootstrap(): void {
  applyAppearance()
  allowMicrophoneForOwnPages()
  lockNavigation()
  registerIpc()
  applyLoginItem()
  startKeyboard()
  const bar = createFloatingBar()
  // Se a barra cair no meio de uma gravação, não deixa os outros apps mutados.
  bar.webContents.on('render-process-gone', () => void unmuteBackgroundAudio().catch(() => 0))

  tray = new Tray(nativeImage.createFromPath(resourcePath('icon.ico')))
  tray.on('click', () => openHub('/dashboard'))
  updateTray()

  // Primeira abertura: o passo a passo. Na inicialização com o Windows, não abre nada.
  if (!process.argv.includes(SILENT_LAUNCH_FLAG)) openHub(onboardingState().completedAt ? '/dashboard' : '/onboarding')

  // Histórico: avisa o Hub quando muda e aplica o tempo de guarda agora e a cada hora.
  setHistoryChangedListener(() => broadcast(IPC.historyChanged))
  void applyRetention().then((n) => n && console.log(`[histórico] ${n} item(ns) passaram do tempo de guarda`))
  setInterval(() => void applyRetention(), HISTORY_RETENTION_CHECK_MS).unref()

  setLastVoiceFlowListener((last) => broadcast(IPC.lastVoiceFlowBroadcast, last))
  // Ao subir, o servidor recebe a chave do Groq guardada no app (D95).
  void ensureLocalServer((line) => console.log(line)).then(async () => {
    await pushGroqKeyToServer()
    await refreshUsage()
  })
  void deviceEnvironment() // aquece o WMI (fabricante e modelo) antes do primeiro ditado
  setInterval(() => void refreshUsage(), USAGE_POLL_MS).unref()

  app.on('before-quit', () => {
    markQuitting()
    closeHistory()
    keyboard?.stop()
    stopLocalServer()
    void unmuteBackgroundAudio().catch(() => 0)
  })
  console.log(`[just-say] pronto. estado da máquina: ${lastMachineState}`)
}

// App de bandeja: fechar o Hub não encerra o app.
app.on('window-all-closed', () => {})
