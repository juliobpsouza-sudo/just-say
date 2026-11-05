// Escolha do microfone. Funções puras, testadas em tests/microphone.test.ts.

export interface MicDevice {
  deviceId: string
  label: string
}

const BUILT_IN = /(interno|integrad|internal|built-?in|matriz de microfones|array de microfones|microphone array|mic(rophone)? array)/i
const VIRTUAL = /(stereo mix|mixagem est[ée]reo|what u hear|cable output|voicemeeter)/i

export function isBuiltInMic(label: string): boolean {
  return BUILT_IN.test(label)
}

/**
 * Microfones que aparecem na lista: sem a entrada "communications" do Windows e sem as
 * entradas virtuais que repetem o som do PC.
 */
export function visibleMics(devices: readonly MicDevice[]): MicDevice[] {
  return devices.filter((d) => d.deviceId !== 'communications' && d.deviceId !== 'default' && !VIRTUAL.test(d.label))
}

/**
 * Modo automático: o padrão do Windows. Com a tampa do notebook **fechada** e o padrão sendo o
 * microfone embutido (que fica abafado), usa o primeiro microfone externo.
 * `lidOpen`: 1 aberta, 0 fechada, -1 sem tampa ou desconhecido. Devolve o deviceId ou null (= padrão).
 */
export function pickAutoMic(devices: readonly MicDevice[], defaultLabel: string | null, lidOpen: number): string | null {
  if (lidOpen !== 0 || !defaultLabel || !isBuiltInMic(defaultLabel)) return null
  return visibleMics(devices).find((d) => !isBuiltInMic(d.label))?.deviceId ?? null
}
