// Fase 7 no main: aprendizado por edição, dica de uso, estilo
// pessoal e os avisos com ação na barra.
import { hostname } from 'node:os'
import { IPC, type BarNotice, type KeyboardSnapshot } from '../shared/ipc'
import { comboLabel } from '../shared/shortcuts'
import { canShowTypingHint, isTypingKey, TypingCounter } from '../shared/typingHint'
import type { VoiceFlowResult } from '../shared/voiceFlow'
import { EditTracker, type EditResult } from './editTracker'
import { historyRow, recentDictationTexts, setEditedText } from './history/historyService'
import { readField } from './native/contextHelper'
import { shell } from 'electron'
import { safeExternalUrl } from '../shared/urls'
import { dictionaryDelete, notionUndo, sendTraits, styleRebuild } from './server/client'
import { getSettings, settingsStore } from './settings'
import { allWindows, floatingBar } from './windows'

export function showBarNotice(notice: BarNotice): void {
  floatingBar()?.webContents.send(IPC.barNotice, notice)
}

function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of allWindows()) win.webContents.send(channel, ...args)
}

// ---------- aprendizado por edição ----------

const tracker = new EditTracker({
  readField,
  onEdit: (r) => void onEdit(r),
  log: (line) => console.log(line),
})

/**
 * Começa a observar o campo depois de uma colagem de ditado ou tradução. Só com o
 * aprendizado ligado e a leitura da tela permitida (a bandeja e as listas de bloqueio valem).
 */
export function trackInsertion(sessionId: string, text: string): void {
  const s = settingsStore()
  if (!s.get('editLearningEnabled') || !s.get('readScreenContext')) return
  tracker.start(sessionId, text)
}

async function onEdit(r: EditResult): Promise<void> {
  setEditedText(r.sessionId, r.after)
  try {
    const res = await sendTraits({
      inserted_text: r.before,
      before: r.before,
      after: r.after,
      app: historyRow(r.sessionId)?.focused_app ?? null,
      device: hostname(),
    })
    for (const added of res.added) {
      showBarNotice({
        text: `“${added.term}” entrou no seu dicionário.`,
        action: { label: 'Desfazer', id: `dict-undo:${added.user_dictionary_id}` },
      })
    }
    if (res.added.length) broadcast(IPC.dictionaryChanged)
  } catch (err) {
    console.error('[edição] servidor não respondeu', (err as Error).message)
  }
}

// ---------- dica de uso ----------

const typing = new TypingCounter()

export function onKeySnapshot(snapshot: KeyboardSnapshot, recordingActive: boolean): void {
  tracker.onKey(snapshot)
  if (snapshot.type !== 'down' || recordingActive) return
  if (!isTypingKey(snapshot.key, snapshot.pressingKeys)) return
  if (typing.push(Date.now())) void maybeShowTypingHint()
}

async function maybeShowTypingHint(): Promise<void> {
  const s = settingsStore()
  if (!canShowTypingHint(s.get('typingHintEnabled'), s.get('typingHintLastShownAt'), Date.now())) return
  // Só num campo editável de verdade.
  const field = await readField(200, 0).catch(() => null)
  if (!field?.isEditable || field.isPassword) return
  s.set('typingHintLastShownAt', Date.now())
  showBarNotice({
    text: `Digitando bastante? Toque ${comboLabel(s.get('featureShortcutBindings').dictation)} e fale: o Just Say escreve por você.`,
    action: { label: 'Não mostrar mais', id: 'typing-hint-off' },
  })
}

// ---------- ações dos avisos ----------

export async function handleNoticeAction(id: string): Promise<void> {
  if (id.startsWith('open:')) {
    // Só http/https (o link vem do Notion, mas a ação passa pelo renderer).
    const url = safeExternalUrl(id.slice('open:'.length))
    if (url) await shell.openExternal(url)
  } else if (id.startsWith('notion-undo:')) {
    const [, kind, noteId] = id.split(':')
    try {
      await notionUndo(kind, noteId)
      showBarNotice({ text: 'Desfeito: a nota foi tirada do Notion.' })
    } catch (err) {
      showBarNotice({ text: `Não consegui desfazer: ${(err as Error).message}` })
    }
  } else if (id.startsWith('dict-undo:')) {
    try {
      await dictionaryDelete(id.slice('dict-undo:'.length))
      showBarNotice({ text: 'Tirado do dicionário.' })
      broadcast(IPC.dictionaryChanged)
    } catch {
      showBarNotice({ text: 'Não consegui tirar agora. Tire em Configurações → Dicionário.' })
    }
  } else if (id === 'typing-hint-off') {
    settingsStore().set('typingHintEnabled', false)
    broadcast(IPC.settingsChanged, getSettings())
    showBarNotice({ text: 'Certo, não mostro mais essa dica. Dá para religar em Configurações.' })
  }
}

// ---------- estilo pessoal ----------

/** O servidor avisa quando é hora de refazer o perfil; as amostras vêm do histórico local. */
export function refreshStyleIfDue(result: VoiceFlowResult): void {
  if (!result.ok || !result.data.style_refresh_due) return
  void styleRebuild(recentDictationTexts(40))
    .then((s) => console.log(`[estilo] perfil atualizado com ${s.samplesUsed} ditados`))
    .catch((err) => console.log(`[estilo] não atualizei agora: ${(err as Error).message}`))
}
