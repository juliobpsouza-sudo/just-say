// Ponte para o InputHelper.dll (inserção e seleção).
import koffi from 'koffi'
import { nativeDllPath } from '../paths'
import { callAsync, callWithOut, NativeError } from './koffiCall'

export interface InputState {
  pid: number
  exePath: string
  exeName: string
  title: string
  windowClass: string
  focusClass: string
  hasCaret: boolean
  caret?: { x: number; y: number; h: number }
}

let api: ReturnType<typeof load> | null = null

function load() {
  const lib = koffi.load(nativeDllPath('InputHelper.dll'))
  return {
    insertText: lib.func('int insertText(const char16_t *text)'),
    insertRichText: lib.func('int insertRichText(const char16_t *html, const char16_t *text, const char16_t *markdown)'),
    getSelectedText: lib.func('int getSelectedText(_Out_ uint8_t *out, int cap)'),
    getSelectedTextWithSource: lib.func('int getSelectedTextWithSource(_Out_ uint8_t *out, int cap, _Out_ int *source)'),
    getSelectedTextBySimulateCopy: lib.func('int getSelectedTextBySimulateCopy(_Out_ uint8_t *out, int cap)'),
    getCurrentInputState: lib.func('int getCurrentInputState(_Out_ uint8_t *out, int cap)'),
  }
}

function dll() {
  api ??= load()
  return api
}

/** 1 = colado; negativo = erro do DLL. */
export function insertText(text: string): Promise<number> {
  return callAsync<number>(dll().insertText, text)
}

export function insertRichText(html: string, text: string, markdown: string | null): Promise<number> {
  return callAsync<number>(dll().insertRichText, html, text, markdown)
}

export function getSelectedTextUia(): Promise<string> {
  return callWithOut(dll().getSelectedText, [])
}

/** Seleção por UI Automation e de onde veio: 1 = elemento focado, 2 = documento da janela, 0 = nenhuma. */
export async function getSelectedTextUiaWithSource(): Promise<{ text: string; source: number }> {
  const out = Buffer.alloc(64 * 1024)
  const source = [0]
  const n = await callAsync<number>(dll().getSelectedTextWithSource, out, out.length, source)
  if (n < 0) throw new NativeError(n)
  return { text: out.toString('utf8', 0, Math.min(n, out.length - 1)), source: source[0] }
}

export function getSelectedTextBySimulateCopy(): Promise<string> {
  return callWithOut(dll().getSelectedTextBySimulateCopy, [])
}

export async function getCurrentInputState(): Promise<InputState> {
  return JSON.parse(await callWithOut(dll().getCurrentInputState, [], 16 * 1024)) as InputState
}
