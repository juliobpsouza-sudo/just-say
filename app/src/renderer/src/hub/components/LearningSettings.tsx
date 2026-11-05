// Configurações → Aprendizado: estilo pessoal, aprender com as correções,
// dica de uso e tempo de guarda do histórico.
import { useEffect, useState } from 'react'
import type { StyleState } from '../../../../shared/dictionary'
import { HISTORY_RETENTION_OPTIONS } from '../../../../shared/history'
import { IPC } from '../../../../shared/ipc'
import type { AppSettings, EditableSettingKey } from '../../../../shared/settings'

type Result<T> = T | { error: string }
const isError = <T,>(r: Result<T>): r is { error: string } => typeof r === 'object' && r !== null && 'error' in r

export function LearningSettings({ settings, onChange }: { settings: AppSettings; onChange: (s: AppSettings) => void }) {
  const api = window.justSay
  const [style, setStyle] = useState<StyleState | null>(null)
  const [styleMsg, setStyleMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.invoke<Result<StyleState>>(IPC.styleGet).then((r) => (isError(r) ? setStyleMsg(r.error) : setStyle(r)))
  }, [api])

  async function set(key: EditableSettingKey, value: unknown) {
    const res = await api.invoke<{ ok: boolean; settings: AppSettings }>(IPC.settingsSet, key, value)
    onChange(res.settings)
  }

  async function styleCall(channel: string, ...args: unknown[]) {
    setBusy(true)
    setStyleMsg(null)
    const r = await api.invoke<Result<StyleState>>(channel, ...args)
    setBusy(false)
    if (isError(r)) setStyleMsg(r.error)
    else setStyle(r)
    return r
  }

  return (
    <div className="card list">
      <div className="item column">
        <div className="item-row">
          <div className="item-text">
            <div className="item-title">Estilo pessoal</div>
            <div className="muted small">
              A cada ~30 ditados, o app resume o seu jeito de escrever (registro, pontuação, abreviações) e o refino passa
              a seguir esse jeito. Usa só o que você ditou, nunca o texto da tela.
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              disabled={!style}
              checked={style?.enabled ?? false}
              onChange={(e) => void styleCall(IPC.styleSetEnabled, e.target.checked)}
            />
            <span>{style?.enabled ? 'ligado' : 'desligado'}</span>
          </label>
        </div>
        {style?.enabled && (
          <div className="style-box">
            {style.profile ? (
              <>
                <div className="muted small">
                  Seu perfil
                  {style.updatedAt && ` · atualizado em ${new Date(style.updatedAt).toLocaleDateString('pt-BR')}`} ·{' '}
                  {style.samplesUsed} ditados
                </div>
                <pre className="style-profile">{style.profile}</pre>
              </>
            ) : (
              <div className="muted small">Ainda sem perfil: ele aparece depois dos primeiros ditados.</div>
            )}
            <div className="row-actions">
              <button className="secondary" disabled={busy} onClick={() => void styleCall(IPC.styleRebuild)}>
                {busy ? 'Atualizando…' : 'Atualizar agora'}
              </button>
              {style.profile && (
                <button className="secondary" disabled={busy} onClick={() => void styleCall(IPC.styleReset)}>
                  Apagar o perfil
                </button>
              )}
            </div>
          </div>
        )}
        {styleMsg && <div className="error small">{styleMsg}</div>}
      </div>

      <div className="item">
        <div className="item-text">
          <div className="item-title">Aprender com as minhas correções</div>
          <div className="muted small">
            Depois de colar, o app observa o campo por até 15 s. Se você corrigir um nome ou termo (Marcus → Marcos), ele
            entra no Dicionário. Não funciona em campos de senha, nos apps e sites bloqueados nem com a leitura da tela
            desligada.
          </div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.editLearningEnabled}
            onChange={(e) => void set('editLearningEnabled', e.target.checked)}
          />
          <span>{settings.editLearningEnabled ? 'ligado' : 'desligado'}</span>
        </label>
      </div>

      <div className="item">
        <div className="item-text">
          <div className="item-title">Dica de uso</div>
          <div className="muted small">
            Se você digitar muito (mais de 60 teclas em 1 minuto), a barra sugere ditar. No máximo uma vez por dia.
          </div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.typingHintEnabled}
            onChange={(e) => void set('typingHintEnabled', e.target.checked)}
          />
          <span>{settings.typingHintEnabled ? 'ligado' : 'desligado'}</span>
        </label>
      </div>

      <div className="item">
        <div className="item-text">
          <div className="item-title">Guardar o histórico por</div>
          <div className="muted small">O que passar disso é apagado, com o áudio, sozinho.</div>
        </div>
        <select
          className="select"
          value={settings.historyDurationSeconds}
          onChange={(e) => void set('historyDurationSeconds', Number(e.target.value))}
        >
          {HISTORY_RETENTION_OPTIONS.map((o) => (
            <option key={o.seconds} value={o.seconds}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
