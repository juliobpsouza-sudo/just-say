// Painel: estatísticas, atalhos, uso gratuito e último ditado. Com o modo técnico ligado
// (Configurações → Aparência), mostra também o monitor ao vivo da máquina de estados e do
// teclado, para conferir as transições.
import { useEffect, useState } from 'react'
import { IPC, type KeyboardSnapshot, type KeyboardStatus, type MachineStateReport } from '../../../../shared/ipc'
import type { AppSettings } from '../../../../shared/settings'
import { FEATURE_LABELS, RECORDING_FEATURES, type ShortcutBindings } from '../../../../shared/shortcuts'
import { Keys } from '../components/Keys'
import { LastDictation } from '../components/LastDictation'
import { UsageCard } from '../components/UsageCard'
import { PopularUses } from '../components/PopularUses'
import { StatsStrip } from './Stats'
import { UpdateCard } from '../components/UpdateCard'

const MAX_ROWS = 60

const STATUS_LABEL: Record<KeyboardStatus['state'], string> = {
  starting: 'iniciando',
  running: 'ativo',
  restarting: 'reiniciando',
  failed: 'parou',
  stopped: 'parado',
}

function time(at: number): string {
  const d = new Date(at)
  return `${d.toLocaleTimeString('pt-BR')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

export function Dashboard() {
  const api = window.justSay
  const [bindings, setBindings] = useState<ShortcutBindings | null>(null)
  const [technical, setTechnical] = useState(false)
  const [pressing, setPressing] = useState<string[]>([])
  const [status, setStatus] = useState<KeyboardStatus | null>(null)
  const [rows, setRows] = useState<MachineStateReport[]>([])

  useEffect(() => {
    void api.invoke<AppSettings>(IPC.settingsGet).then((s) => {
      setBindings(s.featureShortcutBindings)
      setTechnical(s.showTechnicalMonitor)
    })
    void api.invoke<KeyboardStatus | null>(IPC.keyboardGetStatus).then(setStatus)
    const offs = [
      api.on(IPC.globalKeyboard, (s) => setPressing((s as KeyboardSnapshot).pressingKeys)),
      api.on(IPC.keyboardStatus, (s) => setStatus(s as KeyboardStatus)),
      api.on(IPC.settingsChanged, (s) => {
        setBindings((s as AppSettings).featureShortcutBindings)
        setTechnical((s as AppSettings).showTechnicalMonitor)
      }),
      api.on(IPC.machineStateBroadcast, (r) => {
        const report = r as MachineStateReport
        setRows((prev) => [report, ...prev].slice(0, MAX_ROWS))
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [api])

  const current = rows[0]

  return (
    <section>
      <h1>Painel</h1>
      <UpdateCard compact />
      <StatsStrip />

      <h2>Uso gratuito</h2>
      <UsageCard />

      <div className="section-head">
        <h2>Usos populares</h2>
        <a href="#/utilities">Ver todas as dicas →</a>
      </div>
      <PopularUses />

      <h2>Último ditado</h2>
      <LastDictation />

      {bindings && (
        <div className="card how" style={{ marginTop: 28 }}>
          {RECORDING_FEATURES.map((f) => (
            <div key={f}>
              <div className="item-title">{FEATURE_LABELS[f].title}</div>
              <Keys keys={bindings[f]} />
            </div>
          ))}
          <div>
            <div className="item-title">Cancelar (gravando)</div>
            <Keys keys={bindings.cancel} />
          </div>
        </div>
      )}

      {technical && (
        <>
          <h2>Monitor ao vivo</h2>
          <div className="card grid">
            <div>
              <div className="muted small">Estado da máquina</div>
              <div className="mono big">{current?.value ?? 'idle'}</div>
              <div className="muted small">
                modo: {current?.mode ?? '—'} · evento: {current?.event ?? '—'}
              </div>
            </div>
            <div>
              <div className="muted small">Teclas pressionadas agora</div>
              <Keys keys={pressing} empty="nenhuma" />
            </div>
            <div>
              <div className="muted small">Processo do teclado</div>
              <div>
                {status ? STATUS_LABEL[status.state] : '—'}
                {status && status.restarts > 0 && <span className="muted"> · {status.restarts} reinício(s)</span>}
              </div>
              {status?.lastError && <div className="error small">{status.lastError}</div>}
              <button className="secondary small-btn" onClick={() => void api.invoke(IPC.keyboardResetPressing)}>
                Limpar teclas presas
              </button>
            </div>
          </div>

          <h2>Transições</h2>
          <div className="card">
            {rows.length === 0 ? (
              <p className="muted">Toque no atalho de ditado para ver as transições aqui.</p>
            ) : (
              <table className="log">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Estado</th>
                    <th>Evento</th>
                    <th>Sessão</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.at}-${i}`}>
                      <td className="mono">{time(r.at)}</td>
                      <td className="mono">{r.value}</td>
                      <td className="mono muted">{r.event}</td>
                      <td className="mono muted">{r.sessionId?.slice(0, 8) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  )
}
