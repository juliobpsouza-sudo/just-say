// Histórico: ditados, perguntas e traduções, com busca, copiar,
// ouvir, refazer e apagar. O tempo de guarda fica em Configurações.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HistoryItem, HistoryPage } from '../../../../shared/history'
import { IPC } from '../../../../shared/ipc'
import { languageLabel } from '../../../../shared/languages'
import { displayDomain } from '../../../../shared/urls'
import type { VoiceFlowMode, VoiceFlowResult } from '../../../../shared/voiceFlow'

const api = () => window.justSay

const MODE_FILTERS: { value: VoiceFlowMode | null; label: string }[] = [
  { value: null, label: 'Tudo' },
  { value: 'voice_transcript', label: 'Ditado' },
  { value: 'voice_command', label: 'Just Ask' },
  { value: 'voice_translation', label: 'Tradução' },
]

const MODE_BADGE: Record<VoiceFlowMode, string> = {
  voice_transcript: 'Ditado',
  voice_command: 'Just Ask',
  voice_translation: 'Tradução',
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Hoje'
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function duration(s: number | null): string {
  if (s === null) return ''
  const total = Math.round(s)
  return total < 60 ? `${total} s` : `${Math.floor(total / 60)} min ${total % 60} s`
}

export function History() {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<VoiceFlowMode | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const query = useRef({ text, mode })
  query.current = { text, mode }

  const load = useCallback(async (append: boolean, before: string | null = null) => {
    setLoading(true)
    const page = await api().invoke<HistoryPage>(IPC.historyList, { ...query.current, before, limit: 50 })
    setItems((prev) => (append ? [...prev, ...page.items] : page.items))
    setNext(page.next)
    setLoading(false)
  }, [])

  // Busca com uma pausa curta enquanto digita.
  useEffect(() => {
    const t = setTimeout(() => void load(false), 200)
    return () => clearTimeout(t)
  }, [text, mode, load])

  useEffect(() => api().on(IPC.historyChanged, () => void load(false)), [load])

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(null), 4000)
  }

  async function removeAll() {
    if (!window.confirm('Apagar todo o histórico e os áudios? Não dá para desfazer.')) return
    const n = await api().invoke<number>(IPC.historyDeleteAll)
    flash(`${n} item(ns) apagado(s).`)
  }

  const groups: { day: string; items: HistoryItem[] }[] = []
  for (const item of items) {
    const day = dayLabel(item.createdAt)
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] })
    groups.at(-1)!.items.push(item)
  }

  return (
    <section>
      <h1>Histórico</h1>
      <div className="history-tools">
        <input
          className="search"
          value={text}
          placeholder="Buscar no que você ditou…"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="segmented">
          {MODE_FILTERS.map((f) => (
            <button key={f.label} className={mode === f.value ? 'on' : ''} onClick={() => setMode(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {notice && <p className="small muted">{notice}</p>}

      {!loading && items.length === 0 && (
        <p className="muted">{text || mode ? 'Nada encontrado.' : 'Ainda não há nada no histórico. Dite algo com o atalho.'}</p>
      )}

      {groups.map((g) => (
        <div key={g.day}>
          <h2 className="day">{g.day}</h2>
          <div className="card list">
            {g.items.map((item) => (
              <HistoryRow key={item.id} item={item} onFlash={flash} />
            ))}
          </div>
        </div>
      ))}

      <div className="row-actions">
        {next && (
          <button className="secondary" disabled={loading} onClick={() => void load(true, next)}>
            {loading ? 'Carregando…' : 'Carregar mais'}
          </button>
        )}
        {items.length > 0 && (
          <button className="secondary danger" onClick={() => void removeAll()}>
            Apagar todo o histórico
          </button>
        )}
      </div>
    </section>
  )
}

function HistoryRow({ item, onFlash }: { item: HistoryItem; onFlash: (msg: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
  }, [audioUrl])

  const shown = item.editedText ?? item.text
  const meta = [
    new Date(item.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    item.app,
    item.domain,
    duration(item.durationS),
    item.mode === 'voice_translation' && item.outputLanguage && `→ ${languageLabel(item.outputLanguage)}`,
    item.mode === 'voice_command' && item.selectedChars > 0 && `seleção de ${item.selectedChars} caracteres`,
    item.editedText && 'corrigido por você',
  ].filter(Boolean)

  async function copy() {
    if (!shown) return
    // Pelo main: aqui o navigator.clipboard é bloqueado pela regra de permissões (D91).
    const ok = await api().invoke<boolean>(IPC.clipboardWriteText, shown).catch(() => false)
    onFlash(ok ? 'Copiado. Cole com Ctrl+V onde quiser.' : 'Não consegui copiar.')
  }

  async function retry() {
    setBusy(true)
    const r = await api().invoke<VoiceFlowResult>(IPC.historyRetry, item.id)
    setBusy(false)
    onFlash(r.ok ? 'Refeito e copiado.' : `Falhou de novo: ${r.error.message}`)
  }

  async function listen() {
    if (audioUrl) return
    const buf = await api().invoke<ArrayBuffer | null>(IPC.historyAudio, item.id)
    if (!buf) {
      onFlash('O áudio deste item não está mais salvo.')
      return
    }
    setAudioUrl(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })))
  }

  async function remove() {
    await api().invoke(IPC.historyDelete, [item.id])
  }

  return (
    <div className="item column history-item">
      <div className="history-head">
        <span className={`badge ${item.status === 'completed' ? 'ok' : 'bad'}`}>
          {item.status === 'completed' ? MODE_BADGE[item.mode] : 'erro'}
        </span>
        <span className="muted small">{meta.join(' · ')}</span>
      </div>
      {item.mode === 'voice_command' && item.userPrompt && <p className="muted small prompt">“{item.userPrompt}”</p>}
      {item.status === 'error' && <p className="error small">{item.errorMessage}</p>}
      {shown && (
        <p className={`history-text ${expanded ? 'expanded' : ''}`} onClick={() => setExpanded(!expanded)}>
          {item.delivery === 'external' ? `Abriu ${displayDomain(shown)}` : shown}
        </p>
      )}
      {expanded && item.rawText && item.rawText !== shown && (
        <p className="muted small">
          <b>Fala crua:</b> {item.rawText}
        </p>
      )}
      {audioUrl && <audio controls autoPlay src={audioUrl} className="history-audio" />}
      <div className="history-actions">
        {shown && (
          <button className="link" onClick={() => void copy()}>
            Copiar
          </button>
        )}
        {item.hasAudio && (
          <>
            <button className="link" onClick={() => void listen()}>
              Ouvir
            </button>
            <button className="link" disabled={busy} onClick={() => void retry()}>
              {busy ? 'Refazendo…' : 'Refazer'}
            </button>
          </>
        )}
        <button className="link danger" onClick={() => void remove()}>
          Apagar
        </button>
      </div>
    </div>
  )
}
