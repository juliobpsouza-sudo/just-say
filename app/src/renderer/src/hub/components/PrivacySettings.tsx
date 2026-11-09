// Configurações → Privacidade: ler ou não o contexto da tela, e onde nunca ler.
import { useState } from 'react'
import { DEFAULT_BLOCKED_APPS, DEFAULT_BLOCKED_SITES } from '../../../../shared/contextLists'
import { IPC } from '../../../../shared/ipc'
import type { AppSettings, EditableSettingKey } from '../../../../shared/settings'

function ListEditor({
  title,
  hint,
  items,
  placeholder,
  normalize,
  onChange,
}: {
  title: string
  hint: string
  items: string[]
  placeholder: string
  normalize: (v: string) => string
  onChange: (items: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = normalize(draft)
    if (v && !items.includes(v)) onChange([...items, v].sort())
    setDraft('')
  }
  return (
    <div className="item column">
      <div className="item-text">
        <div className="item-title">{title}</div>
        <div className="muted small">{hint}</div>
      </div>
      <div className="chips">
        {items.map((i) => (
          <span key={i} className="chip">
            {i}
            <button aria-label={`Tirar ${i}`} onClick={() => onChange(items.filter((x) => x !== i))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="add-row">
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="secondary" onClick={add}>
          Adicionar
        </button>
      </div>
    </div>
  )
}

const normalizeExe = (v: string) => {
  const t = v.trim().toLowerCase()
  return t && !t.endsWith('.exe') ? `${t}.exe` : t
}

const normalizeSite = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]

export function PrivacySettings({ settings, onChange }: { settings: AppSettings; onChange: (s: AppSettings) => void }) {
  const api = window.justSay
  async function set(key: EditableSettingKey, value: unknown) {
    const res = await api.invoke<{ ok: boolean; settings: AppSettings }>(IPC.settingsSet, key, value)
    onChange(res.settings)
  }

  return (
    <div className="card list">
      <div className="item">
        <div className="item-text">
          <div className="item-title">Ler o contexto da tela</div>
          <div className="muted small">
            Com isso ligado, o texto visível e o que já está escrito no campo vão para o modelo junto com a sua fala, para
            ele acertar nomes e o tom. Desligado, vai só o nome do app, o título da janela e o domínio do site.
          </div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.readScreenContext}
            onChange={(e) => void set('readScreenContext', e.target.checked)}
          />
          <span>{settings.readScreenContext ? 'ligado' : 'desligado'}</span>
        </label>
      </div>
      <div className="item">
        <div className="item-text">
          <div className="item-title">Deixar o texto no Ctrl+C</div>
          <div className="muted small">
            Ligado, tudo o que você dita também fica copiado depois de colar, para colar de novo onde quiser. Ele aparece no
            histórico do Win+V, como uma cópia normal. Desligado, o que estava copiado antes volta, e o texto ditado não fica
            no histórico do Win+V.
          </div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.keepTranscriptInClipboard}
            onChange={(e) => void set('keepTranscriptInClipboard', e.target.checked)}
          />
          <span>{settings.keepTranscriptInClipboard ? 'ligado' : 'desligado'}</span>
        </label>
      </div>
      <ListEditor
        title="Apps onde nunca leio a tela"
        hint="Pelo nome do programa (o .exe). Gerenciadores de senha, conversas privadas, terminais, acesso remoto e Office vêm na lista."
        items={settings.contextBlockedApps}
        placeholder="ex.: whatsapp.exe"
        normalize={normalizeExe}
        onChange={(items) => void set('contextBlockedApps', items)}
      />
      <ListEditor
        title="Sites onde nunca leio a tela"
        hint="Vale também para os subdomínios (bb.com.br bloqueia www2.bb.com.br). Bancos, pagamentos, logins e governo vêm na lista."
        items={settings.contextBlockedSites}
        placeholder="ex.: meubanco.com.br"
        normalize={normalizeSite}
        onChange={(items) => void set('contextBlockedSites', items)}
      />
      <div className="item">
        <span className="muted small">Mexeu demais nas listas?</span>
        <button
          className="secondary"
          onClick={async () => {
            await set('contextBlockedApps', [...DEFAULT_BLOCKED_APPS])
            await set('contextBlockedSites', [...DEFAULT_BLOCKED_SITES])
          }}
        >
          Restaurar as listas padrão
        </button>
      </div>
    </div>
  )
}
