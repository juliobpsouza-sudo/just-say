import { useEffect, useRef, useState } from 'react'
import { TIMING } from '../../../shared/constants'
import { IPC, noticeActions } from '../../../shared/ipc'
import { createRecordingController, type BarActions, type BarView } from './controller'

const INITIAL: BarView = {
  state: 'idle',
  mode: null,
  recordingStartedAt: null,
  countdown: false,
  alert: null,
  error: null,
  disabled: false,
  notice: null,
  targetLanguage: null,
  canSwitchLanguage: false,
  selection: null,
}

function label(view: BarView): string {
  const s = view.state
  if (s.startsWith('initializing') || s === 'awaiting_long_press_or_tap') return 'Preparando…'
  if (s === 'long_pressing') return 'Solte a tecla'
  if (s === 'recording_active.translationModeHandsFree') return 'Ouvindo para traduzir'
  if (s.startsWith('recording_active')) return view.mode === 'ask_anything' ? 'Ouvindo sua pergunta' : 'Ouvindo'
  if (s === 'finishing')
    return view.mode === 'ask_anything' ? 'Pensando…' : view.mode === 'translation' ? 'Traduzindo…' : 'Processando…'
  if (s === 'stopping') return 'Cancelado'
  if (s === 'retrying') return 'Tentando de novo…'
  if (s === 'error' || s === 'failure') return view.error?.message ?? 'Algo deu errado'
  return 'Pronto'
}

const ALERTS: Record<NonNullable<BarView['alert']>, string> = {
  dont_hold: 'Não segure a tecla. Toque uma vez para começar e outra para terminar.',
  wrong_key: 'Outra tecla foi apertada. Gravação cancelada.',
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [active])
  return now
}

function selectionLabel(selection: BarView['selection']): string | null {
  if (!selection) return null
  if (selection.state === 'reading') return 'lendo a seleção…'
  if (selection.state === 'none') return 'sem seleção'
  return `sobre a seleção (${selection.chars.toLocaleString('pt-BR')} caracteres)`
}

export function App() {
  const [view, setView] = useState<BarView>(INITIAL)
  const actions = useRef<BarActions | null>(null)
  useEffect(() => createRecordingController(setView, (a) => (actions.current = a)), [])

  // A barra deixa o clique atravessar; só o chip do idioma pede o clique (mouse por cima).
  const setInteractive = (on: boolean) => window.justSay.send(IPC.floatingBarInteractive, on)

  const recording = view.state.startsWith('recording_active')
  const now = useNow(recording)
  const elapsed = recording && view.recordingStartedAt ? now - view.recordingStartedAt : 0
  const remaining = TIMING.MAX_DURATION_MS - elapsed
  const tone =
    view.state === 'error' || view.state === 'failure'
      ? 'bad'
      : view.state === 'long_pressing' || view.state === 'stopping'
        ? 'warn'
        : recording
          ? 'live'
          : 'busy'

  return (
    <div className="stage">
      {view.alert && <div className="alert">{ALERTS[view.alert]}</div>}
      {view.notice && (
        <div className="alert notice">
          {view.notice.text}
          {noticeActions(view.notice).map((a) => (
            <button
              key={a.id}
              type="button"
              className="notice-action"
              onMouseEnter={() => setInteractive(true)}
              onMouseLeave={() => setInteractive(false)}
              onClick={() => {
                window.justSay.send(IPC.barNoticeAction, a.id)
                setInteractive(false)
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {view.state !== 'idle' && (
        <div className={`pill ${tone}`}>
          <span className="indicator" aria-hidden>
            {recording ? (
              <span className="wave">
                <i />
                <i />
                <i />
                <i />
              </span>
            ) : (
              <span className="dot" />
            )}
          </span>
          <span className="label">{label(view)}</span>
          {view.targetLanguage && view.state !== 'error' && view.state !== 'failure' && (
            <button
              type="button"
              className={`chip ${view.canSwitchLanguage ? 'switchable' : ''}`}
              title={view.canSwitchLanguage ? 'Clique para trocar o idioma de destino' : 'Idioma de destino'}
              onMouseEnter={() => view.canSwitchLanguage && setInteractive(true)}
              onMouseLeave={() => setInteractive(false)}
              onClick={() => actions.current?.switchLanguage()}
            >
              → {view.targetLanguage}
            </button>
          )}
          {view.selection && recording && <span className="chip muted">{selectionLabel(view.selection)}</span>}
          {recording && (
            <span className={`clock ${view.countdown ? 'countdown' : ''}`}>
              {view.countdown ? `faltam ${formatClock(remaining)}` : formatClock(elapsed)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
