// Configurações → Áudio: microfone, sons, silenciar o áudio de fundo e o atraso do som de início.
import { useEffect, useState } from 'react'
import { IPC } from '../../../../shared/ipc'
import type { AppSettings, EditableSettingKey, StartSoundDelayMode } from '../../../../shared/settings'
import { visibleMics, type MicDevice } from '../../../../shared/microphone'
import { describeDecision, type StartSoundDecision } from '../../../../shared/startSound'

const DELAY_OPTIONS: { value: StartSoundDelayMode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Automático', hint: 'Atrasa só quando o fone é Bluetooth (ele corta o começo do som ao ligar o microfone).' },
  { value: 'always', label: 'Sempre atrasar', hint: 'Espera 1,2 s antes do som de início.' },
  { value: 'never', label: 'Nunca atrasar', hint: 'O som de início toca na hora do toque.' },
]

export function AudioSettings({ settings, onChange }: { settings: AppSettings; onChange: (s: AppSettings) => void }) {
  const api = window.justSay
  const [decision, setDecision] = useState<StartSoundDecision | null>(null)

  useEffect(() => {
    void api.invoke<StartSoundDecision>(IPC.audioStartSoundDecision, null).then(setDecision)
  }, [api, settings.startSoundDelayMode])

  async function set(key: EditableSettingKey, value: unknown) {
    const res = await api.invoke<{ ok: boolean; settings: AppSettings }>(IPC.settingsSet, key, value)
    onChange(res.settings)
  }

  return (
    <div className="card list">
      <MicrophoneRow settings={settings} onSelect={(id) => void set('selectedMicrophoneDevice', id)} />

      <div className="item">
        <div className="item-text">
          <div className="item-title">Sons de início e fim</div>
          <div className="muted small">Um tom curto quando a gravação começa e quando termina.</div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.enableInteractionSoundEffects}
            onChange={(e) => void set('enableInteractionSoundEffects', e.target.checked)}
          />
          <span>{settings.enableInteractionSoundEffects ? 'ligado' : 'desligado'}</span>
        </label>
      </div>

      <div className="item">
        <div className="item-text">
          <div className="item-title">Silenciar o áudio de fundo</div>
          <div className="muted small">Muta músicas e vídeos dos outros apps enquanto você dita, e devolve no fim.</div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.enabledMuteBackgroundAudio}
            onChange={(e) => void set('enabledMuteBackgroundAudio', e.target.checked)}
          />
          <span>{settings.enabledMuteBackgroundAudio ? 'ligado' : 'desligado'}</span>
        </label>
      </div>

      <div className="item column">
        <div className="item-text">
          <div className="item-title">Atraso do som de início</div>
          <div className="muted small">{decision ? describeDecision(decision) : 'Detectando o fone…'}</div>
        </div>
        <div className="radio-group">
          {DELAY_OPTIONS.map((o) => (
            <label key={o.value} className={`radio ${settings.startSoundDelayMode === o.value ? 'on' : ''}`}>
              <input
                type="radio"
                name="startSoundDelayMode"
                checked={settings.startSoundDelayMode === o.value}
                onChange={() => void set('startSoundDelayMode', o.value)}
              />
              <span>
                <b>{o.label}</b>
                <span className="muted small"> {o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Microfone: automático ou um aparelho fixo. */
function MicrophoneRow({ settings, onSelect }: { settings: AppSettings; onSelect: (id: string | null) => void }) {
  const [mics, setMics] = useState<MicDevice[]>([])
  const [defaultLabel, setDefaultLabel] = useState<string | null>(null)

  useEffect(() => {
    const refresh = async () => {
      const inputs = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microfone sem nome' }))
      setMics(visibleMics(inputs))
      setDefaultLabel(inputs.find((d) => d.deviceId === 'default')?.label.replace(/^(Padrão|Default) - /, '') ?? null)
    }
    void refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [])

  const selected = settings.selectedMicrophoneDevice
  const missing = selected !== null && mics.length > 0 && !mics.some((m) => m.deviceId === selected)

  return (
    <div className="item">
      <div className="item-text">
        <div className="item-title">Microfone</div>
        <div className="muted small">
          {selected === null
            ? `Automático: usa o padrão do Windows${defaultLabel ? ` (agora: ${defaultLabel})` : ''}. Com a tampa do notebook fechada, evita o microfone embutido.`
            : missing
              ? 'O microfone escolhido não está conectado: uso o padrão do Windows até ele voltar.'
              : 'Sempre este microfone; se ele sair, uso o padrão do Windows.'}
        </div>
      </div>
      <select className="select" value={selected ?? ''} onChange={(e) => onSelect(e.target.value || null)}>
        <option value="">Automático</option>
        {missing && <option value={selected}>(desconectado)</option>}
        {mics.map((m) => (
          <option key={m.deviceId} value={m.deviceId}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  )
}
