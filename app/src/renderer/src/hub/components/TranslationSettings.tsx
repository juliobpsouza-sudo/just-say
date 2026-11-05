// Configurações → Tradução: até 3 idiomas de destino e qual está ativo.
import { useState } from 'react'
import { LIMITS } from '../../../../shared/constants'
import { IPC } from '../../../../shared/ipc'
import { activeTargetLanguage, languageLabel, TRANSLATION_LANGUAGES } from '../../../../shared/languages'
import type { AppSettings, EditableSettingKey } from '../../../../shared/settings'
import { comboLabel } from '../../../../shared/shortcuts'

export function TranslationSettings({ settings, onChange }: { settings: AppSettings; onChange: (s: AppSettings) => void }) {
  const api = window.justSay
  const [adding, setAdding] = useState('')
  const targets = settings.translationModeTargetLanguageCodes
  const active = activeTargetLanguage(targets, settings.translationModeAlertPreferredLanguageCode)
  const full = targets.length >= LIMITS.TRANSLATION_TARGET_LANGUAGES_MAX

  async function set(key: EditableSettingKey, value: unknown) {
    const res = await api.invoke<{ ok: boolean; settings: AppSettings }>(IPC.settingsSet, key, value)
    onChange(res.settings)
  }

  async function add(code: string) {
    setAdding('')
    if (!code || targets.includes(code) || full) return
    await set('translationModeTargetLanguageCodes', [...targets, code])
    // A primeira da lista vira a ativa.
    if (targets.length === 0) await set('translationModeAlertPreferredLanguageCode', code)
  }

  async function remove(code: string) {
    await set(
      'translationModeTargetLanguageCodes',
      targets.filter((c) => c !== code),
    )
  }

  return (
    <div className="card list">
      <div className="item column">
        <div className="item-text">
          <div className="item-title">Idiomas de destino</div>
          <div className="muted small">
            Com {comboLabel(settings.featureShortcutBindings.translation)}, você fala em qualquer idioma e o texto entra
            traduzido. Escolha até {LIMITS.TRANSLATION_TARGET_LANGUAGES_MAX}; clique num idioma para deixá-lo ativo. Durante
            a gravação, um clique no idioma da barra passa para o próximo.
          </div>
        </div>
        <div className="chips">
          {targets.length === 0 && <span className="muted small">Nenhum idioma escolhido: a tradução não funciona.</span>}
          {targets.map((code) => (
            <span key={code} className={`chip ${code === active ? 'on' : ''}`}>
              <span
                role="button"
                className="chip-label"
                title={code === active ? 'Idioma ativo' : 'Deixar ativo'}
                onClick={() => void set('translationModeAlertPreferredLanguageCode', code)}
              >
                {code === active ? '● ' : ''}
                {languageLabel(code)}
              </span>
              <button aria-label={`Tirar ${languageLabel(code)}`} onClick={() => void remove(code)}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="add-row">
          <select value={adding} disabled={full} onChange={(e) => void add(e.target.value)}>
            <option value="">{full ? `Máximo de ${LIMITS.TRANSLATION_TARGET_LANGUAGES_MAX} idiomas` : 'Adicionar idioma…'}</option>
            {TRANSLATION_LANGUAGES.filter((l) => !targets.includes(l.code)).map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
