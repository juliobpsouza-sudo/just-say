// Ponte para o UtilHelper.dll (áudio do sistema, dispositivos, tampa, device id, WMI).
import koffi from 'koffi'
import { nativeDllPath } from '../paths'
import { callAsync, callWithOut } from './koffiCall'

export interface AudioDevice {
  id: string
  name: string
  flow: 'render' | 'capture'
  isDefault: boolean
  isDefaultCommunication: boolean
  formFactor: number
  containerId: string
  enumerator: string
  bluetooth: boolean
}

let api: ReturnType<typeof load> | null = null

function load() {
  const lib = koffi.load(nativeDllPath('UtilHelper.dll'))
  return {
    muteAudio: lib.func('int muteAudio(const char *excludePidsJson)'),
    unmuteAudio: lib.func('int unmuteAudio()'),
    isMutedByUs: lib.func('int isMutedByUs()'),
    getAudioDevices: lib.func('int getAudioDevices(_Out_ uint8_t *out, int cap)'),
    deviceIsLidOpen: lib.func('int deviceIsLidOpen()'),
    getDeviceId: lib.func('int getDeviceId(const char16_t *appName, _Out_ uint8_t *out, int cap)'),
    wmiQuery: lib.func('int wmiQuery(const char16_t *ns, const char16_t *wql, _Out_ uint8_t *out, int cap)'),
  }
}

function dll() {
  api ??= load()
  return api
}

/** Muta as sessões de áudio de outros processos. Devolve quantas mutou. */
export function muteAudio(excludePids: number[]): Promise<number> {
  return callAsync<number>(dll().muteAudio, JSON.stringify(excludePids))
}

export function unmuteAudio(): Promise<number> {
  return callAsync<number>(dll().unmuteAudio)
}

export function isMutedByUs(): boolean {
  return (dll().isMutedByUs() as number) === 1
}

export async function getAudioDevices(): Promise<AudioDevice[]> {
  return JSON.parse(await callWithOut(dll().getAudioDevices, [])) as AudioDevice[]
}

/** 1 aberta, 0 fechada, -1 sem tampa ou desconhecido. */
export function deviceIsLidOpen(): Promise<number> {
  return callAsync<number>(dll().deviceIsLidOpen)
}

export function getDeviceId(appName: string): Promise<string> {
  return callWithOut(dll().getDeviceId, [appName], 256)
}

export async function wmiQuery<T = Record<string, string | null>>(wql: string, ns = 'ROOT\\CIMV2'): Promise<T[]> {
  return JSON.parse(await callWithOut(dll().wmiQuery, [ns, wql])) as T[]
}
