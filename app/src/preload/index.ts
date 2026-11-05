// Ponte entre renderers e main. Só os canais de IPC_ALLOWED passam.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_ALLOWED } from '../shared/ipc'

function assertAllowed(channel: string): void {
  if (!IPC_ALLOWED.includes(channel)) throw new Error(`Canal IPC não permitido: ${channel}`)
}

const api = {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    assertAllowed(channel)
    return ipcRenderer.invoke(channel, ...args) as Promise<T>
  },
  send(channel: string, ...args: unknown[]): void {
    assertAllowed(channel)
    ipcRenderer.send(channel, ...args)
  },
  on(channel: string, listener: (...args: unknown[]) => void): () => void {
    assertAllowed(channel)
    const wrapped = (_e: IpcRendererEvent, ...args: unknown[]) => listener(...args)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.off(channel, wrapped)
  },
}

export type JustSayApi = typeof api

contextBridge.exposeInMainWorld('justSay', api)
