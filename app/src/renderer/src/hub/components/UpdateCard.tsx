// Atualização pelo botão (D99). `compact`: só aparece quando há versão nova (Painel).
import { useEffect, useState } from 'react'
import { IPC } from '../../../../shared/ipc'
import type { UpdateState } from '../../../../shared/update'

const api = () => window.justSay

export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    void api().invoke<UpdateState>(IPC.updateGet).then(setState)
    return api().on(IPC.updateChanged, (s) => setState(s as UpdateState))
  }, [])
  return state
}

export function UpdateCard({ compact = false }: { compact?: boolean }) {
  const s = useUpdateState()
  if (!s) return null
  const busy = s.status === 'preparing' || s.status === 'restarting'
  if (compact && s.status !== 'available' && !busy && s.status !== 'updated') return null

  const notes = s.notesUrl ? (
    <button className="link" onClick={() => void api().invoke(IPC.openExternalUrl, s.notesUrl)}>
      ver o que mudou
    </button>
  ) : null

  return (
    <div className="card">
      {s.status === 'unsupported' && (
        <p className="muted small">
          Versão {s.current}. A atualização pelo botão funciona na instalação pelo ZIP do GitHub (com o Instalar.cmd).
        </p>
      )}
      {(s.status === 'idle' || s.status === 'uptodate' || s.status === 'checking') && (
        <div className="row">
          <span className={s.status === 'uptodate' ? 'ok-text' : 'muted'}>
            {s.status === 'uptodate' ? `✓ Você está na versão mais nova (${s.current}).` : `Versão ${s.current}.`}
          </span>
          <button className="secondary" disabled={s.status === 'checking'} onClick={() => void api().invoke(IPC.updateCheck)}>
            {s.status === 'checking' ? 'Procurando…' : 'Procurar atualização'}
          </button>
        </div>
      )}
      {s.status === 'available' && (
        <>
          <div className="row">
            <span>
              <b>Versão {s.latest} disponível</b> <span className="muted">(você está na {s.current})</span>
            </span>
            <button style={{ marginLeft: 'auto' }} onClick={() => void api().invoke(IPC.updateApply)}>
              Atualizar agora
            </button>
          </div>
          <p className="muted small">
            Baixa só o que mudou, fecha e abre o Just Say de novo, já atualizado. Suas configurações, chave, dicionário e
            histórico continuam. {notes}
          </p>
        </>
      )}
      {busy && <p className="muted">{s.step ?? 'Atualizando…'}</p>}
      {s.status === 'updated' && (
        <p className="ok-text">
          ✓ Atualizado para a versão {s.current}. {notes}
        </p>
      )}
      {s.status === 'error' && (
        <div className="row">
          <span className="error small">{s.error}</span>
          <button className="secondary" onClick={() => void api().invoke(IPC.updateCheck)}>
            Tentar de novo
          </button>
        </div>
      )}
    </div>
  )
}
