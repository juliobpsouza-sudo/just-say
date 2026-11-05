// Painel → último ditado: transcrição crua, texto final, modelos usados, tempos e refazer.
import { useEffect, useState } from 'react'
import { IPC } from '../../../../shared/ipc'
import { summarizeAudioContext } from '../../../../shared/audioContext'
import { languageLabel } from '../../../../shared/languages'
import { displayDomain } from '../../../../shared/urls'
import type { LastVoiceFlow, VoiceFlowResult } from '../../../../shared/voiceFlow'

const MODE_LABEL: Record<string, string> = {
  full: 'lido',
  blocked: 'bloqueado pela lista',
  off: 'leitura desligada',
  minimal: 'só o app',
}

/** O que o app leu da tela neste ditado (Fase 5). */
function ContextLine({ ctx }: { ctx: Record<string, unknown> }) {
  const s = summarizeAudioContext(ctx)
  const parts = [
    s.app && `app: ${s.app}`,
    s.site && `site: ${s.site}`,
    s.field && `campo: ${s.field}${s.editable === false ? ' (não parece editável)' : ''}`,
    `contexto: ${MODE_LABEL[s.mode] ?? s.mode}`,
    s.mode === 'full' &&
      `tela ${s.visibleChars.toLocaleString('pt-BR')} caracteres · antes do cursor ${s.beforeChars} · depois ${s.afterChars}`,
    s.captureMs !== null && `leitura em ${s.captureMs} ms`,
    s.timedOut.length > 0 && `estourou o prazo: ${s.timedOut.join(', ')}`,
  ].filter(Boolean)
  return <p className="muted small context-line">{parts.join(' · ')}</p>
}

const ACTION_LABEL: Record<string, string> = {
  colar: 'colou no campo',
  responder: 'respondeu no cartão',
  buscar: 'buscou na web e respondeu no cartão',
  abrir: 'abriu um link',
}

/** Modo do pedido e, no Ask Anything e na Tradução, o que aconteceu (Fase 6). */
function modeLine(last: LastVoiceFlow): string {
  if (last.mode === 'voice_translation')
    return `Modo: Tradução${last.outputLanguage ? ` → ${languageLabel(last.outputLanguage)}` : ''}`
  if (last.mode === 'voice_command') {
    const parts = [
      'Modo: Ask Anything',
      last.selectedChars > 0 ? `seleção de ${last.selectedChars.toLocaleString('pt-BR')} caracteres` : 'sem seleção',
      last.askAction && ACTION_LABEL[last.askAction],
      last.searchProvider && `busca: ${last.searchProvider}`,
    ]
    return parts.filter(Boolean).join(' · ')
  }
  return 'Modo: Ditado'
}

function resultLabel(last: LastVoiceFlow): string {
  if (last.delivery === 'reply') return 'Resposta (mostrada no cartão)'
  if (last.delivery === 'external') return 'Link aberto'
  return last.mode === 'voice_translation' ? 'Texto traduzido colado' : 'Texto colado'
}

export function LastDictation() {
  const api = window.justSay
  const [last, setLast] = useState<LastVoiceFlow | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void api.invoke<LastVoiceFlow | null>(IPC.lastVoiceFlowGet).then(setLast)
    return api.on(IPC.lastVoiceFlowBroadcast, (l) => setLast(l as LastVoiceFlow))
  }, [api])

  async function retry() {
    setRetrying(true)
    setNotice(null)
    const result = await api.invoke<VoiceFlowResult>(IPC.lastVoiceFlowRetry)
    setRetrying(false)
    setNotice(result.ok ? 'Refeito e copiado. Cole com Ctrl+V onde quiser.' : `Falhou de novo: ${result.error.message}`)
  }

  if (!last) return <p className="muted">Nenhum ditado ainda nesta sessão do app.</p>

  return (
    <div className="card">
      <div className="last-head">
        <span className={`badge ${last.ok ? 'ok' : 'bad'}`}>{last.ok ? 'ok' : 'erro'}</span>
        <span className="muted small">
          {new Date(last.at).toLocaleTimeString('pt-BR')}
          {last.serverMs !== null && ` · servidor ${last.serverMs} ms`} · ida e volta {last.roundTripMs} ms
          {last.sttProvider && ` · STT ${last.sttProvider}`}
          {last.refineProvider && ` · refino ${last.refineProvider}`}
        </span>
      </div>
      {last.error && <p className="error small">{last.error.message}</p>}
      <p className="muted small context-line">{modeLine(last)}</p>
      <ContextLine ctx={last.request.audioContext} />
      {last.transcript !== null && (
        <>
          <div className="muted small">{last.mode === 'voice_command' ? 'Pedido falado' : 'Transcrição crua'}</div>
          <p className="quote">{last.transcript || '(vazio)'}</p>
        </>
      )}
      {last.refined !== null && (
        <>
          <div className="muted small">{resultLabel(last)}</div>
          <p className="quote strong">{last.refined || '(vazio)'}</p>
        </>
      )}
      {last.sources.length > 0 && (
        <>
          <div className="muted small">Fontes da busca</div>
          <ol className="small sources-list">
            {last.sources.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  onClick={(e) => {
                    e.preventDefault()
                    void api.invoke(IPC.openExternalUrl, s.url)
                  }}
                >
                  {s.title || displayDomain(s.url)}
                </a>{' '}
                <span className="muted">{displayDomain(s.url)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="row-actions">
        <button className="secondary" disabled={retrying} onClick={() => void retry()}>
          {retrying ? 'Refazendo…' : 'Refazer e copiar'}
        </button>
        {notice && <span className="small muted"> {notice}</span>}
      </div>
    </div>
  )
}
