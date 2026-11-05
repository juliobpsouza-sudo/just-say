import { describe, expect, it } from 'vitest'
import { isBuiltInMic, pickAutoMic, visibleMics } from '../src/shared/microphone'

const devices = [
  { deviceId: 'default', label: 'Padrão - Microfone (Realtek Audio)' },
  { deviceId: 'communications', label: 'Comunicações - Microfone (Realtek Audio)' },
  { deviceId: 'a', label: 'Matriz de microfones (Realtek Audio)' },
  { deviceId: 'b', label: 'Microfone (Headset USB)' },
  { deviceId: 'c', label: 'Mixagem estéreo (Realtek Audio)' },
]

describe('microfone', () => {
  it('reconhece o embutido', () => {
    expect(isBuiltInMic('Matriz de microfones (Realtek Audio)')).toBe(true)
    expect(isBuiltInMic('Microphone Array (Intel Smart Sound)')).toBe(true)
    expect(isBuiltInMic('Microfone (Headset USB)')).toBe(false)
  })
  it('esconde "communications", o padrão e as entradas virtuais', () => {
    expect(visibleMics(devices).map((d) => d.deviceId)).toEqual(['a', 'b'])
  })
  it('automático: tampa fechada com o embutido como padrão → externo', () => {
    expect(pickAutoMic(devices, 'Matriz de microfones (Realtek Audio)', 0)).toBe('b')
  })
  it('automático: tampa aberta, sem tampa ou padrão externo → padrão do Windows', () => {
    expect(pickAutoMic(devices, 'Matriz de microfones (Realtek Audio)', 1)).toBeNull()
    expect(pickAutoMic(devices, 'Matriz de microfones (Realtek Audio)', -1)).toBeNull()
    expect(pickAutoMic(devices, 'Microfone (Headset USB)', 0)).toBeNull()
  })
})
