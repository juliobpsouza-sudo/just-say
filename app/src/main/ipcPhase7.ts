// IPC da Fase 7: histórico, dicionário, estilo pessoal e passo a passo.
import { readFile, stat } from 'node:fs/promises'
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { parseDictionaryCsv } from '../shared/dictionary'
import type { HistoryQuery } from '../shared/history'
import { IPC } from '../shared/ipc'
import type { VoiceFlowResult } from '../shared/voiceFlow'
import { deleteAllHistory, deleteHistory, historyAudio, listHistory, resetStats, statsSummary } from './history/historyService'
import { handleNoticeAction } from './learning'
import { onboardingState, setOnboarding, setPractice } from './onboarding'
import {
  dictionaryAdd,
  dictionaryDelete,
  dictionaryImport,
  dictionaryList,
  dictionaryUpdate,
  notionGet,
  notionSetDefault,
  ServerError,
  styleGet,
  styleRebuild,
  styleReset,
  styleSetEnabled,
} from './server/client'
import { recentDictationTexts } from './history/historyService'
import { retryHistoryItem } from './voiceFlowService'

const MAX_CSV_BYTES = 2 * 1024 * 1024

/** Erro do servidor vira `{ error }` para a tela mostrar, em vez de estourar no renderer. */
async function safe<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ServerError) return { error: err.message }
    return { error: 'O servidor do Just Say não respondeu.' }
  }
}

export function registerPhase7Ipc(deps: {
  afterVoiceFlow: (r: VoiceFlowResult) => VoiceFlowResult
  hubWindow: () => BrowserWindow | null
}): void {
  // ---------- histórico ----------
  ipcMain.handle(IPC.historyList, (_e, query: HistoryQuery) =>
    listHistory({
      text: typeof query?.text === 'string' ? query.text.slice(0, 200) : undefined,
      mode: query?.mode ?? null,
      before: typeof query?.before === 'string' ? query.before : null,
      limit: typeof query?.limit === 'number' ? query.limit : undefined,
    }),
  )
  ipcMain.handle(IPC.historyDelete, (_e, ids: unknown) => deleteHistory(Array.isArray(ids) ? ids.map(String) : []))
  ipcMain.handle(IPC.historyDeleteAll, () => deleteAllHistory())
  ipcMain.handle(IPC.historyRetry, async (_e, id: unknown) => deps.afterVoiceFlow(await retryHistoryItem(String(id))))
  ipcMain.handle(IPC.historyAudio, (_e, id: unknown) => historyAudio(String(id)))

  // ---------- estatísticas (D75) ----------
  ipcMain.handle(IPC.statsGet, () => statsSummary())
  ipcMain.handle(IPC.statsReset, () => resetStats())

  // ---------- dicionário ----------
  ipcMain.handle(IPC.dictionaryList, () => safe(() => dictionaryList()))
  ipcMain.handle(IPC.dictionaryAdd, (_e, term: unknown) => safe(() => dictionaryAdd(String(term ?? ''))))
  ipcMain.handle(IPC.dictionaryUpdate, (_e, id: unknown, term: unknown) => safe(() => dictionaryUpdate(String(id), String(term ?? ''))))
  ipcMain.handle(IPC.dictionaryDelete, (_e, id: unknown) => safe(() => dictionaryDelete(String(id))))
  // Importar CSV: a escolha do arquivo é da pessoa (diálogo do Windows); só a 1ª coluna é lida.
  ipcMain.handle(IPC.dictionaryImportCsv, async () => {
    const win = deps.hubWindow()
    const options = {
      title: 'Importar termos para o dicionário',
      filters: [{ name: 'Lista de termos', extensions: ['csv', 'txt'] }],
      properties: ['openFile' as const],
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
    const file = picked.filePaths[0]
    const info = await stat(file).catch(() => null)
    if (!info || info.size > MAX_CSV_BYTES) return { error: 'Arquivo grande demais (máximo 2 MB).' }
    const terms = parseDictionaryCsv(await readFile(file, 'utf8'))
    if (!terms.length) return { error: 'Não achei termos no arquivo. Ponha um termo por linha.' }
    return safe(() => dictionaryImport(terms))
  })

  // ---------- estilo pessoal ----------
  ipcMain.handle(IPC.styleGet, () => safe(() => styleGet()))
  ipcMain.handle(IPC.styleSetEnabled, (_e, on: unknown) => safe(() => styleSetEnabled(on === true)))
  ipcMain.handle(IPC.styleRebuild, () => safe(() => styleRebuild(recentDictationTexts(40))))
  ipcMain.handle(IPC.styleReset, () => safe(() => styleReset()))

  // ---------- Notion (D72) ----------
  ipcMain.handle(IPC.notionGet, () => safe(() => notionGet(false)))
  ipcMain.handle(IPC.notionRefresh, () => safe(() => notionGet(true)))
  ipcMain.handle(IPC.notionSetDefault, (_e, id: unknown) => safe(() => notionSetDefault(typeof id === 'string' && id ? id : null)))

  // ---------- avisos da barra e passo a passo ----------
  ipcMain.on(IPC.barNoticeAction, (_e, id: unknown) => {
    if (typeof id === 'string') void handleNoticeAction(id)
  })
  ipcMain.handle(IPC.onboardingGet, () => onboardingState())
  ipcMain.handle(IPC.onboardingSet, (_e, patch: { step?: unknown; completed?: unknown }) => setOnboarding(patch ?? {}))
  ipcMain.handle(IPC.onboardingPractice, (_e, on: unknown) => setPractice(on === true))
}
