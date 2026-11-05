// Controlador da barra flutuante: liga teclado → detector → máquina → main.
// Fica fora do React para a máquina não depender do ciclo de vida dos componentes.
import { createActor, fromPromise } from 'xstate'
import { AUDIO, LIMITS, TIMING } from '../../../shared/constants'
import { activeTargetLanguage, dictationLanguagesParam, languageLabel, nextTargetLanguage } from '../../../shared/languages'
import { truncateMiddle } from '../../../shared/tokens'
import { displayDomain } from '../../../shared/urls'
import { richFromMarkdown } from '../lib/richText'
import { IPC, noticeActions, type BarNotice, type KeyboardSnapshot, type MachineStateReport } from '../../../shared/ipc'
import type { AppSettings } from '../../../shared/settings'
import { DEFAULT_SHORTCUTS, type ShortcutBindings } from '../../../shared/shortcuts'
import {
  MODE_TO_VOICE_FLOW,
  minimalAudioContext,
  type FocusedInputInfo,
  type VoiceFlowRequest,
  type VoiceFlowResponse,
  type VoiceFlowResult,
} from '../../../shared/voiceFlow'
import { AudioRecorder, type RecordedAudio } from '../audio/recorder'
import { playSound, selectedMicLabel, type SoundName } from '../audio/sounds'
import type { StartSoundDecision } from '../../../shared/startSound'
import { spaceBeforeInsert } from '../../../shared/insertSpacing'
import { shouldShowCopyCard } from '../../../shared/audioContext'
import { pickAutoMic } from '../../../shared/microphone'
import type { ContextPolicy } from '../../../shared/contextLists'

interface FullContextResult {
  audioContext: Record<string, unknown>
  policy: ContextPolicy | null
  exeName: string | null
}
import { encodeWav } from '../audio/wav'
import {
  isRecordingActive,
  recordingMachine,
  stateName,
  type Alert,
  type ChecksInput,
  type FinishInput,
  type RecordingError,
  type RecordingMode,
  type RecordingResult,
} from '../recording/machine'
import { detectShortcut, INITIAL_DETECTOR, type DetectorState } from '../recording/shortcutDetector'

export interface BarView {
  state: string
  mode: RecordingMode | null
  recordingStartedAt: number | null
  countdown: boolean
  alert: Alert
  error: RecordingError | null
  disabled: boolean
  /** Aviso de uso gratuito (vem do servidor depois de um ditado). */
  notice: BarNotice | null
  /** Tradução: idioma de destino ativo e se dá para trocar com um clique. */
  targetLanguage: string | null
  canSwitchLanguage: boolean
  /** Ask Anything: texto selecionado (lendo, achado com N caracteres ou nenhum). */
  selection: { state: 'reading' } | { state: 'found'; chars: number } | { state: 'none' } | null
}

/** Clique no chip do idioma, na barra. */
export interface BarActions {
  switchLanguage(): void
}

const ALERT_VISIBLE_MS = 2500
/** Mesmo prazo do texto visível no main (src/main/context.ts). */
const VISIBLE_TEXT_TIMEOUT_MS = 1500
const MAX_EXTRA_CONTEXT_WAIT_MS = 600
const NOTICE_VISIBLE_MS = 5000
const NOTICE_WITH_ACTION_VISIBLE_MS = 8000

export function createRecordingController(onView: (view: BarView) => void, actions?: (a: BarActions) => void): () => void {
  const api = window.justSay
  let settings: AppSettings | null = null
  let bindings: ShortcutBindings = DEFAULT_SHORTCUTS
  let disabled = false
  let detector: DetectorState = INITIAL_DETECTOR
  let alertUntil = 0
  let lastAlert: Alert = null
  let barVisible = false
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  const notices: BarNotice[] = []
  let noticeUntil = 0

  // ---------- áudio ----------
  const recorder = new AudioRecorder({
    onNoSpeech: (sessionId) => {
      if (actor.getSnapshot().context.sessionId === sessionId) actor.send({ type: 'NO_SPEECH' })
    },
    onLive: (sessionId) => playStartSound(sessionId),
  })
  let muteTimer: ReturnType<typeof setTimeout> | null = null
  let cancelStartSound: (() => void) | null = null

  // Som de início só quando o microfone já manda som (D93): é o sinal para começar a falar.
  // Se o microfone não acordar em START_SOUND_FALLBACK_MS, toca assim mesmo.
  const START_SOUND_FALLBACK_MS = 3000
  let startSoundFor: { sessionId: string; beganAt: number; fallback: ReturnType<typeof setTimeout> } | null = null
  function playStartSound(sessionId: string) {
    if (!startSoundFor || startSoundFor.sessionId !== sessionId) return
    clearTimeout(startSoundFor.fallback)
    // O atraso do Bluetooth (D45) conta a partir do toque: a espera pelo microfone já faz parte dele.
    const delay = Math.max(0, startSoundDelayMs - (Date.now() - startSoundFor.beganAt))
    startSoundFor = null
    if (settings?.enableInteractionSoundEffects !== false) cancelStartSound = playSound('start', delay)
  }
  function cancelPendingStartSound() {
    if (startSoundFor) clearTimeout(startSoundFor.fallback)
    startSoundFor = null
  }

  // Atraso do som de início, decidido antes do toque (D45): recalcula só quando um
  // dispositivo de áudio ou a configuração muda, para o som sair na hora do toque.
  let startSoundDelayMs = 0
  async function refreshStartSoundDelay() {
    const micLabel = await selectedMicLabel(settings?.selectedMicrophoneDevice ?? null)
    const decision = await api.invoke<StartSoundDecision>(IPC.audioStartSoundDecision, micLabel)
    startSoundDelayMs = decision.delayMs
  }
  navigator.mediaDevices.addEventListener('devicechange', () => {
    // Aparelho trocou: fecha o microfone aquecido; o próximo ditado abre o certo.
    if (!recorder.activeSessionId) recorder.cool()
    void refreshStartSoundDelay()
    void refreshAutoMic()
  })

  // Microfone no modo automático: o padrão do Windows, a não ser com a tampa
  // do notebook fechada e o embutido como padrão. Calculado antes do toque, como o som.
  let autoMicId: string | null = null
  async function refreshAutoMic() {
    autoMicId = null
    if (settings?.selectedMicrophoneDevice) return
    const lid = await api.invoke<number>(IPC.audioLidOpen).catch(() => -1)
    if (lid !== 0) return
    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label }))
      const defaultLabel = inputs.find((d) => d.deviceId === 'default')?.label.replace(/^(Padrão|Default) - /, '') ?? null
      autoMicId = pickAutoMic(inputs, defaultLabel, lid)
    } catch {
      autoMicId = null
    }
  }

  function beginAudio(sessionId: string) {
    if (recorder.activeSessionId === sessionId) return // trocar de modo não reinicia a gravação
    cancelPendingStartSound()
    const beganAt = Date.now()
    startSoundFor = { sessionId, beganAt, fallback: setTimeout(() => playStartSound(sessionId), START_SOUND_FALLBACK_MS) }
    // Com o microfone aquecido, `start` já chama onLive e o som sai na hora.
    recorder.start(sessionId, settings?.selectedMicrophoneDevice ?? autoMicId, beganAt)
    if (muteTimer) clearTimeout(muteTimer)
    muteTimer = setTimeout(() => {
      if (recorder.activeSessionId === sessionId) void api.invoke(IPC.audioMute)
    }, TIMING.MUTE_BACKGROUND_DELAY_MS)
  }

  function endAudio(sound: SoundName | null) {
    if (muteTimer) clearTimeout(muteTimer)
    muteTimer = null
    cancelPendingStartSound()
    cancelStartSound?.()
    cancelStartSound = null
    void api.invoke(IPC.audioUnmute)
    if (sound && settings?.enableInteractionSoundEffects !== false) playSound(sound)
    void refreshAutoMic() // a tampa pode ter mudado até o próximo ditado
  }

  // ---------- contexto e servidor ----------
  // O app em foco é lido já no toque: é ele que vai receber o texto.
  // O contexto completo (Fase 5) também começa no toque, fora do caminho crítico.
  const focusBySession = new Map<string, Promise<FocusedInputInfo | null>>()
  const fullContextBySession = new Map<string, { startedAt: number; promise: Promise<FullContextResult | null> }>()
  const requestsBySession = new Map<string, Pick<VoiceFlowRequest, 'audioContext' | 'audioMetadata' | 'parameters'>>()
  const insertMetaBySession = new Map<string, { textBefore: string; showCopyCard: boolean; trackable: boolean }>()
  // Ask Anything: a seleção é lida assim que o modo vira ask_anything.
  const selectionBySession = new Map<string, Promise<{ text: string; method: string }>>()
  const selectionChars = new Map<string, number>()
  // Resposta completa do servidor (entrega, fontes, link), usada na hora de entregar.
  const responseBySession = new Map<string, VoiceFlowResponse>()

  function readSelection(sessionId: string): void {
    if (selectionBySession.has(sessionId)) return
    const pending = api
      .invoke<{ text: string; method: string }>(IPC.getSelectedText)
      .catch(() => ({ text: '', method: 'none' }))
      .then((r) => ({ text: truncateMiddle(r?.text ?? '', LIMITS.SELECTED_TEXT_TOKENS), method: r?.method ?? 'none' }))
    selectionBySession.set(sessionId, pending)
    void pending.then((r) => {
      selectionChars.set(sessionId, r.text.trim().length)
      render()
    })
  }

  function targetLanguages(): string[] {
    return settings?.translationModeTargetLanguageCodes ?? []
  }

  function currentTargetLanguage(): string | null {
    return activeTargetLanguage(targetLanguages(), settings?.translationModeAlertPreferredLanguageCode ?? null)
  }

  const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), Math.max(0, ms)))])

  async function focusedInfo(sessionId: string): Promise<FocusedInputInfo | null> {
    const pending = focusBySession.get(sessionId)
    return pending ? withTimeout(pending, 300) : null
  }

  /**
   * Contexto para o pedido: o completo, se já chegou (ele tem até 1,5 s desde o toque),
   * senão o mínimo. Num ditado muito curto, espera no máximo 600 ms a mais.
   */
  async function contextFor(sessionId: string): Promise<FullContextResult | null> {
    const entry = fullContextBySession.get(sessionId)
    if (!entry) return null
    const left = entry.startedAt + VISIBLE_TEXT_TIMEOUT_MS + 200 - Date.now()
    return withTimeout(entry.promise, Math.min(MAX_EXTRA_CONTEXT_WAIT_MS, left))
  }

  function toRecordingErrorFromServer(error: { code: string; message: string }): RecordingError {
    switch (error.code) {
      case 'timeout':
        return { code: 'RECOVERABLE_TIMEOUT', message: 'O servidor demorou demais. Refaça pelo Painel.', recoverable: true }
      case 'server_offline':
        return { code: 'RECOVERABLE_NETWORK', message: 'O servidor do Just Say não está rodando.', recoverable: true }
      case 'offline':
        return {
          code: 'RECOVERABLE_NETWORK',
          message: 'Sem internet agora. Confira a conexão e refaça pelo Painel.',
          recoverable: true,
        }
      case 'stt_unavailable':
        return {
          code: 'RECOVERABLE_NETWORK',
          message: 'O Groq não respondeu à transcrição. Refaça pelo Painel.',
          recoverable: true,
        }
      case 'ask_unavailable':
        return {
          code: 'RECOVERABLE_NETWORK',
          message: 'Os modelos gratuitos não responderam ao pedido. Refaça pelo Painel.',
          recoverable: true,
        }
      case 'search_unavailable':
        return {
          code: 'RECOVERABLE_NETWORK',
          message: 'A busca na web não respondeu agora. Refaça pelo Painel daqui a pouco.',
          recoverable: true,
        }
      case 'translation_unavailable':
        return {
          code: 'RECOVERABLE_NETWORK',
          message: 'Não deu para traduzir agora. A fala original está no cartão para copiar.',
          recoverable: true,
        }
      case 'bad_language':
        return { code: 'UNKNOWN', message: 'Escolha o idioma de destino em Configurações → Tradução.', recoverable: false }
      default:
        return { code: 'UNKNOWN', message: error.message || 'Erro no servidor.', recoverable: false }
    }
  }

  async function sendToServer(
    sessionId: string,
    mode: RecordingMode,
    wav: Uint8Array | null,
    request: Pick<VoiceFlowRequest, 'audioContext' | 'audioMetadata' | 'parameters'>,
    isRetry: boolean,
  ): Promise<RecordingResult> {
    const now = Date.now()
    const result = await api.invoke<VoiceFlowResult>(IPC.aiVoiceFlow, {
      requestId: `${sessionId}-${now}`,
      audioId: sessionId,
      mode: MODE_TO_VOICE_FLOW[mode],
      wav: wav ? (wav.buffer as ArrayBuffer) : undefined,
      ...request,
      userOverTime: now,
      sendTime: now,
      isRetry,
      timeoutMs: mode === 'ask_anything' ? TIMING.REFINE_TIMEOUT_ASK_MS : TIMING.REFINE_TIMEOUT_DICTATION_MS,
    } satisfies VoiceFlowRequest)
    if (!result.ok) {
      // Tradução falhou depois de transcrever: não cola sem traduzir, mas oferece a fala (D56).
      if (result.error.transcript) void api.invoke(IPC.copyCardShow, result.error.transcript)
      throw toRecordingErrorFromServer(result.error)
    }
    const text = result.data.refine_text.trim()
    if (!text) throw { code: 'RECOVERABLE_NO_SPEECH_DETECTED', message: 'Nenhuma fala detectada.', recoverable: true }
    responseBySession.set(sessionId, result.data)
    return { text }
  }

  /** Entrega do Ask Anything: cola rico, mostra o cartão ou abre o link. */
  function deliverAskAnything(response: VoiceFlowResponse, text: string, showCopyCard: boolean, sessionId: string | null) {
    if (response.delivery === 'external' && response.external_action?.target) {
      const url = response.external_action.target
      void api.invoke<boolean>(IPC.openExternalUrl, url).then((opened) => {
        notices.push({ text: opened ? `Abrindo ${displayDomain(url)}` : 'O link da resposta não é seguro e não foi aberto.' })
        render()
      })
      return
    }
    // Anotado numa integração (Notion): só o aviso, com Abrir e Desfazer (D72).
    if (response.delivery === 'notice') {
      const r = response.integration_result
      notices.push({
        text: text,
        actions: r
          ? [
              ...(r.note_url ? [{ label: 'Abrir', id: `open:${r.note_url}` }] : []),
              { label: 'Desfazer', id: `notion-undo:${r.note_kind}:${r.note_id}` },
            ]
          : [],
      })
      render()
      return
    }
    if (response.delivery === 'reply') {
      void api.invoke(IPC.answerCardShow, {
        question: response.user_prompt ?? '',
        answer: text,
        sources: response.web_metadata?.sources ?? [],
      })
      return
    }
    const rich = richFromMarkdown(text)
    void api.invoke(IPC.insertRichText, rich.html, rich.text, rich.markdown, { remember: true, showCopyCard, sessionId: sessionId ?? undefined })
  }

  /** `parameters` do pedido: idiomas do ditado, seleção do Ask Anything ou idioma de destino. */
  async function parametersFor(sessionId: string, mode: RecordingMode): Promise<Record<string, unknown>> {
    if (mode === 'ask_anything') {
      readSelection(sessionId) // trocou para Ask Anything no último instante
      const selected = (await withTimeout(selectionBySession.get(sessionId)!, 1000)) ?? { text: '', method: 'none' }
      selectionBySession.delete(sessionId)
      // De onde veio a seleção: lida na página (fora do campo) = não dá para substituir (D70).
      return { selected_text: selected.text, selection_source: selected.method }
    }
    if (mode === 'translation') return { output_language: currentTargetLanguage() }
    return { languages: dictationLanguagesParam(settings?.autoSelectLanguages ?? false, settings?.selectedLanguages ?? []) }
  }

  const machine = recordingMachine.provide({
    actors: {
      // Checagens em paralelo com a gravação: microfone aberto e servidor no ar.
      runChecks: fromPromise<void, ChecksInput>(async ({ input }) => {
        // Tradução sem idioma de destino: avisa e abre a tela para escolher (D58).
        if (input.mode === 'translation' && !currentTargetLanguage()) {
          api.send(IPC.openHub, '/settings')
          throw {
            code: 'INIT_CHECK_FAILED',
            message: 'Escolha o idioma de destino em Configurações → Tradução.',
            recoverable: false,
          }
        }
        const [, health] = await Promise.all([
          input.sessionId ? recorder.ready(input.sessionId) : Promise.resolve(),
          api.invoke<{ ok: boolean; groqConfigured: boolean }>(IPC.serverHealth),
        ])
        if (!health.ok)
          throw { code: 'INIT_CHECK_FAILED', message: 'O servidor do Just Say não está rodando.', recoverable: false }
        if (!health.groqConfigured)
          throw { code: 'INIT_CHECK_FAILED', message: 'Falta a sua chave do Groq: coloque em Configurações → Chave do Groq.', recoverable: false }
      }),
      finishRecording: fromPromise<RecordingResult, FinishInput>(async ({ input }) => {
        let audio: RecordedAudio
        try {
          audio = await recorder.stop(input.sessionId)
        } finally {
          endAudio('stop')
        }
        const wav = encodeWav(audio.pcm, AUDIO.SAMPLE_RATE)
        await api.invoke(IPC.audioSaveRecording, input.sessionId, wav.buffer)
        if (audio.pcm.length === 0) throw { code: 'UNKNOWN', message: 'Nenhum áudio foi gravado.', recoverable: false }

        const full = await contextFor(input.sessionId)
        const audioContext = full?.audioContext ?? minimalAudioContext(await focusedInfo(input.sessionId), navigator.language)
        const field = (audioContext.text_insertion_point ?? {}) as { cursor_state?: { text_before?: string } }
        insertMetaBySession.set(input.sessionId, {
          textBefore: field.cursor_state?.text_before ?? '',
          // Sem campo editável confirmado: cola mesmo assim e mostra o cartão (D61).
          showCopyCard: shouldShowCopyCard(audioContext, full?.policy?.editableWhitelisted ?? false),
          // Aprendizado por edição só onde a tela pode ser lida (listas de bloqueio e bandeja).
          trackable: full !== null && !(full.policy?.blockScreen ?? true),
        })
        const request = {
          audioContext,
          audioMetadata: {
            format: 'wav',
            codec: 'pcm_s16le',
            sample_rate: AUDIO.SAMPLE_RATE,
            channels: AUDIO.CHANNELS,
            duration_ms: Math.round(audio.durationMs),
            record_pressed_to_first_audio_sample_latency_ms: audio.firstSampleLatencyMs,
          },
          parameters: await parametersFor(input.sessionId, input.mode),
        }
        requestsBySession.set(input.sessionId, request)
        focusBySession.delete(input.sessionId)
        fullContextBySession.delete(input.sessionId)
        return sendToServer(input.sessionId, input.mode, wav, request, false)
      }),
      discardRecording: fromPromise<void, { sessionId: string | null }>(async ({ input }) => {
        recorder.discard()
        endAudio('cancel')
        if (input.sessionId) {
          focusBySession.delete(input.sessionId)
          fullContextBySession.delete(input.sessionId)
          selectionBySession.delete(input.sessionId)
          selectionChars.delete(input.sessionId)
        }
      }),
      // Refazer a partir do áudio salvo, com o mesmo contexto.
      retryRecording: fromPromise<RecordingResult, ChecksInput>(async ({ input }) => {
        if (!input.sessionId || !input.mode) throw { code: 'UNKNOWN', message: 'Nada para refazer.', recoverable: false }
        const request = requestsBySession.get(input.sessionId) ?? {
          audioContext: minimalAudioContext(null, navigator.language),
          audioMetadata: {},
          parameters: {},
        }
        return sendToServer(input.sessionId, input.mode, null, request, true)
      }),
    },
    actions: {
      startRecording: ({ context }) => {
        if (!context.sessionId) return
        if (!focusBySession.has(context.sessionId)) {
          focusBySession.set(
            context.sessionId,
            api.invoke<FocusedInputInfo | null>(IPC.getFocusedInputInfo).catch(() => null),
          )
          fullContextBySession.set(context.sessionId, {
            startedAt: Date.now(),
            promise: api.invoke<FullContextResult>(IPC.getFullContext).catch(() => null),
          })
        }
        beginAudio(context.sessionId)
      },
      releaseRecording: () => {
        recorder.discard()
        endAudio(null)
      },
      insertResult: ({ context }, params) => {
        const meta = context.sessionId ? insertMetaBySession.get(context.sessionId) : undefined
        const response = context.sessionId ? responseBySession.get(context.sessionId) : undefined
        if (context.sessionId) {
          insertMetaBySession.delete(context.sessionId)
          responseBySession.delete(context.sessionId)
          selectionChars.delete(context.sessionId)
        }
        const text = params.result.text
        if (context.mode === 'ask_anything' && response) {
          deliverAskAnything(response, text, meta?.showCopyCard ?? false, context.sessionId)
          return
        }
        void api.invoke(IPC.insertText, spaceBeforeInsert(meta?.textBefore, text), {
          remember: true,
          showCopyCard: meta?.showCopyCard ?? false,
          copyText: text,
          ...(context.sessionId ? { sessionId: context.sessionId } : {}),
          ...(meta?.trackable && context.sessionId ? { trackSessionId: context.sessionId } : {}),
        })
      },
    },
  })

  let lastEventType = 'init'
  const actor = createActor(machine, {
    input: {},
    inspect: (ev) => {
      if (ev.type === '@xstate.event' && ev.actorRef === actor) lastEventType = ev.event.type
    },
  })

  let lastState = ''
  actor.subscribe((snapshot) => {
    const state = stateName(snapshot.value)
    const ctx = snapshot.context
    if (ctx.alert && ctx.alert !== lastAlert) alertUntil = Date.now() + ALERT_VISIBLE_MS
    lastAlert = ctx.alert

    const report: MachineStateReport = {
      value: state,
      event: lastEventType,
      sessionId: ctx.sessionId,
      mode: ctx.mode,
      at: Date.now(),
      detail: { countdown: ctx.countdown, alert: ctx.alert, error: ctx.error?.code ?? null },
    }
    if (state !== lastState || lastEventType !== 'init') void api.invoke(IPC.machineStateLog, report)
    lastState = state
    // Ask Anything: lê a seleção logo no começo, enquanto ela ainda está na tela.
    if (ctx.mode === 'ask_anything' && ctx.sessionId && (state.startsWith('initializing') || state === 'awaiting_long_press_or_tap' || isRecordingActive(state)))
      readSelection(ctx.sessionId)
    render()
  })

  function render() {
    const snapshot = actor.getSnapshot()
    const ctx = snapshot.context
    const state = stateName(snapshot.value)
    const now = Date.now()
    const alertActive = now < alertUntil
    // Avisos de uso: um de cada vez, 5 s cada.
    if (now >= noticeUntil && notices.length > 0 && noticeUntil !== 0) notices.shift()
    // Aviso com botão (Desfazer…) fica mais tempo, para dar tempo de clicar.
    if (now >= noticeUntil)
      noticeUntil = notices.length > 0 ? now + (noticeActions(notices[0]).length ? NOTICE_WITH_ACTION_VISIBLE_MS : NOTICE_VISIBLE_MS) : 0
    const notice = noticeUntil > now ? (notices[0] ?? null) : null
    const chars = ctx.sessionId ? selectionChars.get(ctx.sessionId) : undefined
    onView({
      state,
      mode: ctx.mode,
      recordingStartedAt: ctx.recordingStartedAt,
      countdown: ctx.countdown,
      alert: alertActive ? ctx.alert : null,
      error: ctx.error,
      disabled,
      notice,
      targetLanguage: ctx.mode === 'translation' ? languageLabel(currentTargetLanguage()) || null : null,
      canSwitchLanguage: targetLanguages().length > 1,
      selection:
        ctx.mode !== 'ask_anything' || !ctx.sessionId
          ? null
          : chars === undefined
            ? { state: 'reading' }
            : chars > 0
              ? { state: 'found', chars }
              : { state: 'none' },
    })
    setVisible(state !== 'idle' || alertActive || notice !== null)
    const nextChange = Math.min(alertActive ? alertUntil : Infinity, notice ? noticeUntil : Infinity)
    if (Number.isFinite(nextChange)) {
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = setTimeout(render, nextChange - now + 10)
    }
  }

  function setVisible(visible: boolean) {
    if (visible === barVisible) return
    barVisible = visible
    api.send(IPC.floatingBarVisible, visible)
  }

  function onKeyboard(snapshot: KeyboardSnapshot) {
    const state = stateName(actor.getSnapshot().value)
    const result = detectShortcut(detector, snapshot.pressingKeys, Date.now(), {
      bindings,
      cancelEnabled: isRecordingActive(state),
    })
    detector = result.state
    if (disabled) return
    for (const event of result.events) {
      if (event.type === 'PASTE_LAST') api.send(IPC.typeTranscript)
      else actor.send(event)
    }
  }

  const offs = [
    api.on(IPC.globalKeyboard, (s) => onKeyboard(s as KeyboardSnapshot)),
    api.on(IPC.settingsChanged, (s) => {
      settings = s as AppSettings
      bindings = settings.featureShortcutBindings
      void refreshStartSoundDelay()
      void refreshAutoMic()
      render()
    }),
    api.on(IPC.machineDisabledChanged, (d) => {
      disabled = Boolean(d)
      render()
    }),
    api.on(IPC.barNotice, (n) => {
      const notice = n as BarNotice
      if (notice && typeof notice.text === 'string') notices.push(notice)
      render()
    }),
  ]

  void api.invoke<AppSettings>(IPC.settingsGet).then((s) => {
    settings = s
    bindings = s.featureShortcutBindings
    void refreshStartSoundDelay()
    void refreshAutoMic()
  })
  void api.invoke<boolean>(IPC.machineGetDisabled).then((d) => (disabled = d))

  actions?.({
    // Clique no chip "→ Inglês": passa para o próximo idioma da lista e lembra a escolha.
    switchLanguage() {
      const next = nextTargetLanguage(targetLanguages(), currentTargetLanguage())
      if (next) void api.invoke(IPC.settingsSet, 'translationModeAlertPreferredLanguageCode', next)
    },
  })

  actor.start()
  render()

  return () => {
    offs.forEach((off) => off())
    actor.stop()
    recorder.cool()
    endAudio(null)
  }
}
