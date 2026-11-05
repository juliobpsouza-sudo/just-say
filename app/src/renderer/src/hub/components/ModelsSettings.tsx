// Configurações → Modelos: a cascata gratuita de transcrição e de refino.
// Liga/desliga, muda a ordem e mostra quem está esgotado e até quando.
import { useCallback, useEffect, useState } from 'react'
import { IPC } from '../../../../shared/ipc'

interface ProviderStatus {
  id: string
  label: string
  free: boolean
  enabled: boolean
  configured: boolean
  blockedUntil: number | null
  blockReason: 'limit' | 'unavailable' | null
  lastError: string | null
  lastUsedAt: number | null
}

interface ProvidersView {
  stt: ProviderStatus[]
  llm: ProviderStatus[]
}

type Kind = 'stt' | 'llm'

const POLL_MS = 10_000

const hhmm = (t: number) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

function statusText(p: ProviderStatus): { text: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } {
  if (!p.enabled) return { text: 'desligado', tone: 'muted' }
  if (!p.configured) return { text: 'sem chave', tone: 'bad' }
  if (p.blockedUntil && p.blockReason === 'limit') return { text: `esgotado até ${hhmm(p.blockedUntil)}`, tone: 'warn' }
  if (p.blockedUntil) return { text: `fora do ar · tenta de novo às ${hhmm(p.blockedUntil)}`, tone: 'bad' }
  return { text: 'disponível', tone: 'ok' }
}

export function ModelsSettings() {
  const api = window.justSay
  const [view, setView] = useState<ProvidersView | null>(null)
  const [offline, setOffline] = useState(false)

  const load = useCallback(async () => {
    try {
      setView(await api.invoke<ProvidersView>(IPC.providersGet))
      setOffline(false)
    } catch {
      setOffline(true)
    }
  }, [api])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(id)
  }, [load])

  async function save(kind: Kind, list: ProviderStatus[]) {
    if (!view) return
    const toSetting = (l: ProviderStatus[]) => l.map((p) => ({ id: p.id, enabled: p.enabled }))
    const next = { stt: toSetting(kind === 'stt' ? list : view.stt), llm: toSetting(kind === 'llm' ? list : view.llm) }
    setView(await api.invoke<ProvidersView>(IPC.providersSet, next))
  }

  function toggle(kind: Kind, id: string) {
    if (!view) return
    void save(kind, view[kind].map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)))
  }

  function move(kind: Kind, index: number, delta: -1 | 1) {
    if (!view) return
    const list = [...view[kind]]
    const target = index + delta
    if (target < 0 || target >= list.length) return
    ;[list[index], list[target]] = [list[target], list[index]]
    void save(kind, list)
  }

  async function unblock(id: string) {
    setView(await api.invoke<ProvidersView>(IPC.providersUnblock, id))
  }

  if (offline)
    return (
      <p className="error small">
        O servidor do Just Say não está respondendo. Em desenvolvimento, o app sobe ele sozinho; se não subir, rode{' '}
        <code>npm run dev</code> em <code>Just_Say\server</code>.
      </p>
    )
  if (!view) return <p className="muted">Carregando…</p>

  const section = (kind: Kind, title: string, hint: string) => {
    const list = view[kind]
    const activeId = list.find((p) => p.enabled && p.configured && !p.blockedUntil)?.id
    return (
      <>
        <h3>{title}</h3>
        <p className="muted small">{hint}</p>
        <div className="card list">
          {list.map((p, i) => {
            const s = statusText(p)
            return (
              <div key={p.id} className="item">
                <div className="item-text">
                  <div className="item-title">
                    {i + 1}. {p.label} {p.id === activeId && <span className="badge ok">em uso agora</span>}
                  </div>
                  <div className={`small tone-${s.tone}`}>
                    {s.text}
                    {p.blockedUntil && (
                      <button className="link" onClick={() => void unblock(p.id)}>
                        tentar já
                      </button>
                    )}
                  </div>
                  {p.lastError && p.blockedUntil && <div className="muted small">{p.lastError}</div>}
                </div>
                <div className="item-control">
                  <button className="secondary icon" aria-label="Subir" disabled={i === 0} onClick={() => move(kind, i, -1)}>
                    ↑
                  </button>
                  <button
                    className="secondary icon"
                    aria-label="Descer"
                    disabled={i === list.length - 1}
                    onClick={() => move(kind, i, 1)}
                  >
                    ↓
                  </button>
                  <label className="switch">
                    <input type="checkbox" checked={p.enabled} onChange={() => toggle(kind, p.id)} />
                    <span>{p.enabled ? 'ligado' : 'desligado'}</span>
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      </>
    )
  }

  return (
    <>
      <p className="muted">
        Tudo aqui é gratuito. O Just Say usa o primeiro modelo disponível de cada lista. Quando o limite gratuito de um
        acaba, ele passa sozinho para o próximo e volta quando o limite libera.
      </p>
      {section('stt', 'Transcrição (fala → texto)', 'O Whisper local só funciona depois de instalado (server\\local-whisper\\LEIA-ME.md).')}
      {section('llm', 'Refino (limpeza do texto)', '"Sem refino" é o último recurso: cola a transcrição como veio.')}
    </>
  )
}
