// Painel → uso gratuito: quantos ditados ainda cabem, o modelo em uso de cada parte e,
// fechado em "Ver detalhes por modelo", a lista completa com todos os limites.
import { useEffect, useState, type ReactNode } from 'react'
import { IPC } from '../../../../shared/ipc'
import { formatCount, usageOverview, type PartOverview, type ProviderUsage, type UsageReport, type UsageWindow } from '../../../../shared/usage'

const POLL_MS = 15_000

const fmt = (n: number) => n.toLocaleString('pt-BR')

const svg = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)
const MIC = svg('M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1 -6 0z M5 10a7 7 0 0 0 14 0 M8 21h8 M12 17v4')
const SPARKLE = svg('M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z')

const TONE_LABEL = { ok: 'Folgado', warn: 'Acabando', bad: 'Esgotado' } as const

function Meter({ w, unit }: { w: UsageWindow; unit: string }) {
  const ratio = w.limit > 0 ? w.remaining / w.limit : 0
  const tone = ratio < 0.1 ? 'bad' : ratio < 0.3 ? 'warn' : 'ok'
  return (
    <div className="meter-row">
      <div className="meter">
        <div className={`meter-fill ${tone}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <span className="small">
        {fmt(w.remaining)} de {fmt(w.limit)} {unit}
      </span>
    </div>
  )
}

function ProviderRow({ p }: { p: ProviderUsage }) {
  return (
    <div className={`usage-provider ${p.enabled ? '' : 'off'}`}>
      <div className="item-title small">
        {p.label}
        {!p.enabled && <span className="muted"> · desligado</span>}
        {p.enabled && !p.unlimited && !p.observed && <span className="muted"> · ainda não usado</span>}
      </div>
      {p.unlimited ? (
        <div className="small muted">sem limite</div>
      ) : (
        <>
          {p.requests && <Meter w={p.requests} unit="pedidos hoje" />}
          {p.audioSeconds && <Meter w={p.audioSeconds} unit="s de áudio nesta hora" />}
          {p.tokens && <Meter w={p.tokens} unit="tokens neste minuto" />}
        </>
      )}
    </div>
  )
}

/** Uma parte (Transcrição ou Refino): o modelo em uso e uma barra só. */
function Part({ title, icon, part }: { title: string; icon: ReactNode; part: PartOverview }) {
  const pct = part.ratio === null ? null : Math.round(part.ratio * 100)
  const reserves = part.reserves === 1 ? '+1 reserva' : part.reserves > 1 ? `+${part.reserves} reservas` : 'sem reserva'
  return (
    <div className="usage-part">
      <div className="usage-part-head">
        <span className="usage-part-title">
          <span className="usage-icon" aria-hidden>
            {icon}
          </span>
          {title}
        </span>
        <span className="usage-pct">{pct === null ? 'sem limite' : `${pct}%`}</span>
      </div>
      <div className="usage-bar">
        <i className={part.barTone} style={{ width: `${pct ?? 100}%` }} />
      </div>
      <div className="muted small">
        {part.model ? `${part.model} · ${reserves}` : 'nenhum modelo ligado'}
      </div>
    </div>
  )
}

export function UsageCard() {
  const api = window.justSay
  const [report, setReport] = useState<UsageReport | null | undefined>(undefined)

  useEffect(() => {
    const load = () => void api.invoke<UsageReport | null>(IPC.usageGet).then(setReport)
    load()
    const id = setInterval(load, POLL_MS)
    const off = api.on(IPC.usageChanged, (r) => setReport(r as UsageReport | null))
    return () => {
      clearInterval(id)
      off()
    }
  }, [api])

  if (report === undefined) return <p className="muted">Carregando…</p>
  if (report === null) return <p className="error small">O servidor não respondeu; o uso aparece quando ele voltar.</p>

  const stt = report.providers.filter((p) => p.kind === 'stt')
  const llm = report.providers.filter((p) => p.kind === 'llm' && p.id !== 'none')
  const o = usageOverview(report)

  return (
    <div className="card usage-card">
      <div className="usage-top">
        <div>
          <div className="usage-hero">
            <span className="usage-hero-num">{formatCount(report.dictationsWithRefine)}</span>
            <span className="muted">ditados ainda cabem</span>
          </div>
        </div>
        <span className={`usage-status ${o.tone}`}>
          <span className="dot" aria-hidden />
          {TONE_LABEL[o.tone]}
        </span>
      </div>

      <div className="usage-parts">
        <Part title="Transcrição" icon={MIC} part={o.stt} />
        <Part title="Refino" icon={SPARKLE} part={o.llm} />
      </div>

      <details className="usage-details">
        <summary>Ver detalhes por modelo</summary>
        {report.dictationsTranscriptOnly !== 0 && (
          <p className="small">
            Se o refino esgotar, ainda cabem <b>{formatCount(report.dictationsTranscriptOnly)}</b> ditados só com transcrição.
          </p>
        )}
        <div className="usage-grid">
          <div>
            <h3>Transcrição</h3>
            {stt.map((p) => (
              <ProviderRow key={p.id} p={p} />
            ))}
          </div>
          <div>
            <h3>Refino</h3>
            {llm.map((p) => (
              <ProviderRow key={p.id} p={p} />
            ))}
          </div>
        </div>
        <p className="muted small">
          Os limites recarregam aos poucos, não à meia-noite: cada pedido usado volta depois de ~43 s na transcrição e
          ~86 s no refino. Os números de um modelo só aparecem depois que ele é usado pela primeira vez.
        </p>
      </details>
    </div>
  )
}
