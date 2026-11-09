// Inserção de texto no app em foco: uma de cada vez (trava de reentrância) e 500 ms de
// espera depois de colar ("cuidados do JS").
import { setTimeout as sleep } from 'node:timers/promises'
import { clipboard, ClipboardItem } from 'electron'
import { TIMING } from '../shared/constants'
import { settingsStore } from './settings'
import * as input from './native/inputHelper'

/** Executáveis de terminal: lá não se simula Ctrl+C. */
export const TERMINAL_EXES = ['cmd.exe', 'powershell.exe', 'pwsh.exe', 'wt.exe', 'windowsterminal.exe', 'warp.exe', 'mintty.exe']

export function isTerminalExe(exeName: string): boolean {
  return TERMINAL_EXES.includes(exeName.toLowerCase())
}

export interface InsertResult {
  ok: boolean
  code: number
}

let queue: Promise<unknown> = Promise.resolve()
let lastTranscript: string | null = null

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.then(
    () => sleep(TIMING.PASTE_SETTLE_MS),
    () => sleep(TIMING.PASTE_SETTLE_MS),
  )
  return run
}

/**
 * Todo resultado de voz também fica no Ctrl+C (D98), em silêncio. A colagem usa o clipboard
 * e agenda a volta do conteúdo antigo para 500 ms depois; a InputHelper não faz essa volta se
 * o clipboard mudou nesse meio-tempo. Então gravamos o texto 300 ms depois de colar: dá tempo
 * de o app de destino ler o Ctrl+V e cancela a restauração. A próxima colagem só começa depois
 * dos 500 ms de espera da fila, então esta gravação nunca atropela outra.
 */
function keepInClipboard(write: () => Promise<void>): void {
  if (!settingsStore().get('keepTranscriptInClipboard')) return
  setTimeout(() => {
    write().catch((err) => console.error('[inserir] não deu para deixar o texto no Ctrl+C', err))
  }, 300)
}

export function insertText(text: string, opts: { remember?: boolean } = {}): Promise<InsertResult> {
  if (opts.remember) lastTranscript = text
  return enqueue(async () => {
    const code = await input.insertText(text)
    if (opts.remember) keepInClipboard(() => clipboard.writeText(text))
    return { ok: code === 1, code }
  })
}

export function insertRichText(
  html: string,
  text: string,
  markdown: string | null,
  opts: { remember?: boolean } = {},
): Promise<InsertResult> {
  // "Colar última transcrição" reinsere o texto puro.
  if (opts.remember) lastTranscript = text
  return enqueue(async () => {
    const code = await input.insertRichText(html, text, markdown)
    if (opts.remember) keepInClipboard(() => clipboard.write([new ClipboardItem({ 'text/plain': text, 'text/html': html })]))
    return { ok: code === 1, code }
  })
}

export function pasteLastTranscript(): Promise<InsertResult> | null {
  return lastTranscript ? insertText(lastTranscript) : null
}

/** De onde veio a última seleção lida (para o log; nunca o texto). */
export interface SelectionRead {
  text: string
  method: 'uia_focus' | 'uia_document' | 'copy' | 'none'
  uiaError: number | null
  copyError: number | null
  ms: number
}

/**
 * Texto selecionado no app em foco: primeiro por UI Automation (no elemento focado e, se
 * vazio, no documento da janela, D70); se ainda vazio, por cópia simulada, exceto em
 * terminais.
 */
export async function getSelectedText(): Promise<SelectionRead> {
  const read = await readSelection()
  const exe = (await input.getCurrentInputState().catch(() => null))?.exeName ?? '?'
  console.log(
    `[seleção] ${exe}: ${read.method}, ${read.text.length} caracteres, ${read.ms} ms` +
      (read.uiaError !== null ? `, UIA ${read.uiaError}` : '') +
      (read.copyError !== null ? `, cópia ${read.copyError}` : ''),
  )
  return read
}

async function readSelection(): Promise<SelectionRead> {
  const started = Date.now()
  let uiaError: number | null = null
  try {
    const { text, source } = await input.getSelectedTextUiaWithSource()
    if (text.trim())
      return { text, method: source === 2 ? 'uia_document' : 'uia_focus', uiaError, copyError: null, ms: Date.now() - started }
  } catch (err) {
    // sem TextPattern: tenta a cópia simulada
    uiaError = (err as { code?: number }).code ?? -99
  }
  const state = await input.getCurrentInputState().catch(() => null)
  if (state && isTerminalExe(state.exeName)) return { text: '', method: 'none', uiaError, copyError: null, ms: Date.now() - started }
  let copyError: number | null = null
  const text = await enqueue(() =>
    input.getSelectedTextBySimulateCopy().catch((err: { code?: number }) => {
      copyError = err.code ?? -99
      return ''
    }),
  )
  return { text, method: text.trim() ? 'copy' : 'none', uiaError, copyError, ms: Date.now() - started }
}
