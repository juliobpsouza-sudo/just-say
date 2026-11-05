// Ponte para a ContextHelper.dll: chamadas assíncronas que respondem por callback (requestId, json).
// Cada chamada tem um tempo-limite também aqui no JS; uma resposta atrasada é ignorada.
import koffi from 'koffi'
import type { RawAppCapture, RawFocusCapture } from '../../shared/audioContext'
import { nativeDllPath } from '../paths'

interface Dll {
  captureApp: (id: number, timeoutMs: number, wantUrl: number) => number
  captureFocus: (id: number, optionsJson: string) => number
  readField: (id: number, timeoutMs: number, maxChars: number) => number
}

let dll: Dll | null = null
let nextId = 1
const pending = new Map<number, (json: string) => void>()

function load(): Dll {
  if (dll) return dll
  const lib = koffi.load(nativeDllPath('ContextHelper.dll'))
  const Callback = koffi.proto('void JustSayContextCallback(int requestId, const char *json)')
  const init = lib.func('int ctxInit(JustSayContextCallback *cb)')
  const callback = koffi.register((id: number, json: string) => {
    const resolve = pending.get(id)
    pending.delete(id)
    resolve?.(json)
  }, koffi.pointer(Callback))
  init(callback)
  dll = {
    captureApp: lib.func('int ctxCaptureApp(int requestId, int timeoutMs, int wantUrl)'),
    captureFocus: lib.func('int ctxCaptureFocus(int requestId, const char *optionsJson)'),
    readField: lib.func('int ctxReadField(int requestId, int timeoutMs, int maxChars)'),
  }
  return dll
}

function request<T>(start: (id: number) => number, jsTimeoutMs: number): Promise<T | null> {
  const id = nextId++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve(null)
    }, jsTimeoutMs)
    pending.set(id, (json) => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(json) as T)
      } catch {
        resolve(null)
      }
    })
    if (start(id) !== 1) {
      clearTimeout(timer)
      pending.delete(id)
      resolve(null)
    }
  })
}

/** App em foco e URL do navegador. */
export function captureApp(timeoutMs: number, wantUrl: boolean): Promise<RawAppCapture | null> {
  return request<RawAppCapture>((id) => load().captureApp(id, timeoutMs, wantUrl ? 1 : 0), timeoutMs + 150)
}

export interface FocusOptions {
  timeoutMs: number
  visibleTimeoutMs: number
  cursorChars: number
  visibleChars: number
  surroundingChars: number
  readText: boolean
}

/** Campo focado, texto visível e entorno. */
export function captureFocus(opts: FocusOptions): Promise<RawFocusCapture | null> {
  const jsTimeout = Math.max(opts.timeoutMs, opts.visibleTimeoutMs) + 200
  return request<RawFocusCapture>((id) => load().captureFocus(id, JSON.stringify(opts)), jsTimeout)
}

/** Leitura leve do campo focado (aprendizado por edição e dica de uso). Nunca lê senha. */
export interface FieldRead {
  /** RuntimeId da UI Automation: muda quando o foco vai para outro campo. */
  id: string
  pid: number
  controlType: number
  frameworkId: string
  isEditable: boolean
  isPassword: boolean
  textKnown: boolean
  text: string
}

export async function readField(timeoutMs: number, maxChars: number): Promise<FieldRead | null> {
  const res = await request<{ field: FieldRead | null }>((id) => load().readField(id, timeoutMs, maxChars), timeoutMs + 150)
  return res?.field ?? null
}
