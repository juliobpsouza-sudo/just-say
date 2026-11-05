// Store `app-settings` (electron-store). Criado sob demanda: o nome do app precisa
// estar definido antes, para o arquivo cair em %APPDATA%\Just Say.
import Store from 'electron-store'
import { DEFAULT_TRANSLATION_TARGETS } from '../shared/languages'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/settings'
import {
  DEFAULT_SHORTCUTS,
  normalizeCombo,
  validateBindings,
  type ShortcutBindings,
  type ShortcutFeature,
} from '../shared/shortcuts'

let store: Store<AppSettings> | null = null

export function settingsStore(): Store<AppSettings> {
  if (!store) {
    store = new Store<AppSettings>({ name: 'app-settings', defaults: DEFAULT_SETTINGS })
    // Completa atalhos que faltem num arquivo antigo.
    const current = store.get('featureShortcutBindings')
    store.set('featureShortcutBindings', { ...DEFAULT_SHORTCUTS, ...current })
    // Arquivo de antes da Fase 6 tem a lista de idiomas vazia (o padrão antigo): uma única
    // vez, põe o inglês. Se a pessoa esvaziar a lista depois, ela fica vazia (D58).
    if (!store.get('__COMPATIBLE_translationDefaultTargets')) {
      if (store.get('translationModeTargetLanguageCodes').length === 0)
        store.set('translationModeTargetLanguageCodes', [...DEFAULT_TRANSLATION_TARGETS])
      store.set('__COMPATIBLE_translationDefaultTargets', true)
    }
  }
  return store
}

export function getSettings(): AppSettings {
  return settingsStore().store
}

export function getShortcuts(): ShortcutBindings {
  return settingsStore().get('featureShortcutBindings')
}

/** Troca um atalho. Devolve a lista de erros (vazia = salvo). */
export function setShortcut(feature: ShortcutFeature, keys: string[]): string[] {
  const next: ShortcutBindings = { ...getShortcuts(), [feature]: normalizeCombo(keys) }
  const errors = validateBindings(next)
  if (errors.length === 0) settingsStore().set('featureShortcutBindings', next)
  return errors
}

export function resetShortcuts(): void {
  settingsStore().set('featureShortcutBindings', DEFAULT_SHORTCUTS)
}
