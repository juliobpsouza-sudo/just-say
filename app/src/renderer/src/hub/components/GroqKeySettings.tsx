// Chave do Groq (D95): a pessoa cola a própria chave, testa e guarda. O app guarda criptografada
// e entrega ao servidor local; esta tela nunca recebe a chave de volta, só os 4 últimos caracteres.
import { useEffect, useState } from 'react'
import { IPC } from '../../../../shared/ipc'

const api = () => window.justSay
const GROQ_KEYS_URL = 'https://console.groq.com/keys'

interface Status {
  saved: boolean
  last4: string | null
  serverConfigured: boolean
}

export function GroqKeySettings({ onSaved }: { onSaved?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [editing, setEditing] = useState(false)

  const refresh = () => void api().invoke<Status>(IPC.groqKeyStatus).then(setStatus)
  useEffect(refresh, [])

  async function run(kind: 'test' | 'save') {
    setBusy(true)
    setMsg(null)
    const r = await api().invoke<{ ok: boolean; message: string }>(kind === 'test' ? IPC.groqKeyTest : IPC.groqKeySave, key)
    setBusy(false)
    setMsg({ ok: r.ok, text: r.message })
    if (kind === 'save' && r.ok) {
      setKey('')
      setEditing(false)
      refresh()
      onSaved?.()
    }
  }

  async function remove() {
    await api().invoke(IPC.groqKeyRemove)
    setMsg({ ok: true, text: 'Chave removida deste PC.' })
    refresh()
  }

  const showForm = !status?.saved || editing

  return (
    <div className="card">
      <p>
        O Just Say usa o <b>Groq</b> para transcrever e limpar o que você fala. O plano gratuito basta para o uso diário: crie uma conta,
        gere uma chave e cole aqui.
      </p>
      <p className="muted small">
        A chave fica guardada criptografada neste PC (pela sua conta do Windows) e só é usada para falar com o Groq.
      </p>

      {status?.saved && !editing && (
        <div className="row">
          <span className="ok-text">✓ Chave guardada (termina em …{status.last4})</span>
          <button className="secondary" onClick={() => setEditing(true)}>
            Trocar
          </button>
          <button className="link" onClick={() => void remove()}>
            Remover
          </button>
        </div>
      )}
      {!status?.saved && status?.serverConfigured && (
        <p className="muted small">O servidor já tem uma chave pelo arquivo server\.env. Guardar uma aqui passa a valer no lugar dela.</p>
      )}

      {showForm && (
        <>
          <ol className="small">
            <li>
              Abra{' '}
              <button className="link" onClick={() => void api().invoke(IPC.openExternalUrl, GROQ_KEYS_URL)}>
                console.groq.com/keys
              </button>{' '}
              e entre (dá para usar a conta do Google).
            </li>
            <li>Clique em <b>Create API Key</b>, dê um nome (ex.: Just Say) e copie a chave que começa com <code>gsk_</code>.</li>
            <li>Cole abaixo e clique em <b>Guardar</b>.</li>
          </ol>
          <div className="row">
            <input
              type="password"
              placeholder="gsk_…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              style={{ flex: 1 }}
            />
            <button className="secondary" disabled={!key.trim() || busy} onClick={() => void run('test')}>
              Testar
            </button>
            <button disabled={!key.trim() || busy} onClick={() => void run('save')}>
              {busy ? 'Conferindo…' : 'Guardar'}
            </button>
          </div>
        </>
      )}
      {msg && <p className={msg.ok ? 'ok-text' : 'error small'}>{msg.text}</p>}
    </div>
  )
}
