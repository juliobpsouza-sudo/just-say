import { join } from 'node:path'
import { app } from 'electron'

/**
 * O app roda a partir da pasta do projeto (atalho da Área de Trabalho ou `npm run dev`)?
 * Não usa `app.isPackaged`: ele só olha o nome do executável, e o atalho abre o app pelo
 * `Just Say.exe` (cópia renomeada do Electron, D74), o que o faria valer `true`.
 * `process.defaultApp` é `true` sempre que o Electron abre uma pasta de app passada na
 * linha de comando, que é o nosso caso nos dois jeitos de abrir.
 */
export function runningFromProject(): boolean {
  return process.defaultApp === true
}

/** Pasta `resources/` do projeto (dev) ou do app instalado. */
export function resourcesDir(): string {
  return runningFromProject() ? join(app.getAppPath(), 'resources') : process.resourcesPath
}

export function resourcePath(...parts: string[]): string {
  return join(resourcesDir(), ...parts)
}

export function nativeDllPath(name: string): string {
  return resourcePath('native', name)
}
