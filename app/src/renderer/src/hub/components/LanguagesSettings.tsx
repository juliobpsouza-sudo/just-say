// Configurações → Idiomas do ditado: automático ou os idiomas que você fala.
import { useState } from 'react'
import { IPC } from '../../../../shared/ipc'
import { DICTATION_LANGUAGES, DICTATION_LANGUAGES_MAX } from '../../../../shared/languages'
import type { AppSettings, EditableSettingKey } from '../../../../shared/settings'

export function LanguagesSettings({ settings, onChange }: { settings: AppSettings; onChange: (s: AppSettings) => void }) {
  const api = window.justSay
  const [adding, setAdding] = useState('')
  const selected = settings.selectedLanguages
  const auto = settings.autoSelectLanguages || selected.length === 0
  const full = selected.length >= DICTATION_LANGUAGES_MAX
  const label = (code: string) => DICTATION_LANGUAGES.find((l) => l.code === code)?.label ?? code

  async function set(key: EditableSettingKey, value: unknown) {
    const res = await api.invoke<{ ok: boolean; settings: AppSettings }>(IPC.settingsSet, key, value)
    onChange(res.settings)
  }

  async function chooseAuto(on: boolean) {
    await set('autoSelectLanguages', on)
    // Ao sair do automático sem nada escolhido, começa pelo português do Brasil.
    if (!on && selected.length === 0) await set('selectedLanguages', ['pt-BR'])
  }

  return (
    <div className="card list">
      <div className="item column">
        <div className="item-text">
          <div className="item-title">Em que idioma você fala</div>
          <div className="muted small">
            Com um idioma só, a transcrição fica mais precisa (o app não precisa adivinhar). Com mais de um, ou no
            automático, ela detecta a cada ditado.
          </div>
        </div>
        <div className="radio-group">
          <label className={`radio ${auto ? 'on' : ''}`}>
            <input type="radio" name="dictationLang" checked={auto} onChange={() => void chooseAuto(true)} />
            <span>
              <b>Detectar automaticamente</b>
            </span>
          </label>
          <label className={`radio ${!auto ? 'on' : ''}`}>
            <input type="radio" name="dictationLang" checked={!auto} onChange={() => void chooseAuto(false)} />
            <span>
              <b>Escolher</b>
              <span className="muted small"> até {DICTATION_LANGUAGES_MAX} idiomas</span>
            </span>
          </label>
        </div>
        {!auto && (
          <>
            <div className="chips">
              {selected.map((code) => (
                <span key={code} className="chip">
                  {label(code)}
                  <button aria-label={`Tirar ${label(code)}`} onClick={() => void set('selectedLanguages', selected.filter((c) => c !== code))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="add-row">
              <select
                value={adding}
                disabled={full}
                onChange={(e) => {
                  const code = e.target.value
                  setAdding('')
                  if (code && !selected.includes(code)) void set('selectedLanguages', [...selected, code])
                }}
              >
                <option value="">{full ? `Máximo de ${DICTATION_LANGUAGES_MAX} idiomas` : 'Adicionar idioma…'}</option>
                {DICTATION_LANGUAGES.filter((l) => !selected.includes(l.code)).map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
