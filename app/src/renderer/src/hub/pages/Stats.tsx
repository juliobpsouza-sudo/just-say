// Estatísticas (D75): palavras ditadas, tempo economizado, sequência de dias, velocidade,
// gráficos dos últimos 30 dias, dos horários e dos apps. Os números vêm da tabela
// `stats_events`, que guarda só números e o nome do app.
import { useCallback, useEffect, useState } from 'react'
import { IPC } from '../../../../shared/ipc'
import type { AppSettings } from '../../../../shared/settings'
import { formatDuration, MAX_TYPING_WPM, MIN_TYPING_WPM, type StatsSummary } from '../../../../shared/stats'

const nf = new Intl.NumberFormat('pt-BR')
const n = (v: number) => nf.format(Math.round(v))

/** "18 de out." a partir de `AAAA-MM-DD`. */
function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })
}

function longDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
}

const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`

export function useStats(): StatsSummary | null {
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const load = useCallback(() => void window.justSay.invoke<StatsSummary>(IPC.statsGet).then(setStats), [])
  useEffect(() => {
    load()
    const offs = [window.justSay.on(IPC.historyChanged, load), window.justSay.on(IPC.settingsChanged, load)]
    return () => offs.forEach((off) => off())
  }, [load])
  return stats
}

/** Faixa curta para o topo do Painel. */
export function StatsStrip() {
  const s = useStats()
  if (!s) return null
  return (
    <div className="stat-tiles compact">
      <Tile label="Hoje" value={n(s.today.words)} unit="palavras" />
      <Tile label="No total" value={n(s.totals.words)} unit="palavras" />
      <Tile label="Economizado" value={formatDuration(s.totals.savedSeconds)} />
      <Tile label="Sequência" value={plural(s.streak.current, 'dia', 'dias')} />
      <a className="stat-more" href="#/stats">
        Ver estatísticas →
      </a>
    </div>
  )
}

function Tile({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit"> {unit}</span>}
      </div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  )
}

/** Barras verticais de uma série só, com a dica ao passar o mouse. */
function Columns({ items, height = 120 }: { items: { key: string; value: number; tip: string; label?: string }[]; height?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="columns" style={{ height }}>
      {items.map((i) => (
        <div key={i.key} className="col" data-tip={i.tip}>
          <div className="col-track">
            <div className={`col-bar${i.value === 0 ? ' zero' : ''}`} style={{ height: `${(i.value / max) * 100}%` }} />
          </div>
          {i.label !== undefined && <div className="col-label">{i.label}</div>}
        </div>
      ))}
    </div>
  )
}

export function Stats() {
  const s = useStats()
  const [wpm, setWpm] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    void window.justSay.invoke<AppSettings>(IPC.settingsGet).then((st) => setWpm(String(st.statsTypingWpm)))
  }, [])

  const saveWpm = (raw: string) => {
    const v = Number(raw)
    if (!Number.isInteger(v) || v < MIN_TYPING_WPM || v > MAX_TYPING_WPM) {
      if (s) setWpm(String(s.typingWpm))
      return
    }
    void window.justSay.invoke(IPC.settingsSet, 'statsTypingWpm', v)
  }

  if (!s) return <section><h1>Estatísticas</h1></section>

  if (s.totals.dictations === 0)
    return (
      <section>
        <h1>Estatísticas</h1>
        <div className="card">
          <p>Ainda não tem nenhum ditado contado. Dite alguma coisa e volte aqui: as palavras, o tempo economizado e a sua sequência de dias aparecem nesta tela.</p>
        </div>
      </section>
    )

  const times = s.speakingWpm ? s.speakingWpm / s.typingWpm : null
  const peakHour = s.hours.indexOf(Math.max(...s.hours))
  const maxApp = Math.max(1, ...s.topApps.map((a) => a.words))
  const remaining = s.milestone.next ? s.milestone.next - s.totals.words : 0
  const prevMilestone = s.milestone.reached ?? 0
  const progress = s.milestone.next ? ((s.totals.words - prevMilestone) / (s.milestone.next - prevMilestone)) * 100 : 100

  return (
    <section className="stats">
      <h1>Estatísticas</h1>
      {s.firstDay && <p className="muted context-line">Desde {longDay(s.firstDay)}.</p>}

      <div className="stat-tiles">
        <Tile label="Palavras ditadas" value={n(s.totals.words)} note={`≈ ${nf.format(s.totals.pages)} páginas de livro`} />
        <Tile
          label="Tempo economizado"
          value={formatDuration(s.totals.savedSeconds)}
          note={`comparado a digitar a ${s.typingWpm} palavras por minuto`}
        />
        <Tile
          label="Sequência"
          value={plural(s.streak.current, 'dia', 'dias')}
          note={`${s.streak.activeToday ? 'hoje já contou' : 'dite hoje para não perder'} · recorde ${plural(s.streak.best, 'dia', 'dias')}`}
        />
        <Tile
          label="Velocidade falando"
          value={s.speakingWpm ? `${n(s.speakingWpm)}` : '—'}
          unit={s.speakingWpm ? 'ppm' : undefined}
          note={times ? `${nf.format(Math.round(times * 10) / 10)}× mais rápido que digitar` : 'dite um pouco mais para medir'}
        />
      </div>

      <div className="stat-pair">
        <div className="card">
          <div className="stat-label">Hoje</div>
          <div className="usage-mid">{plural(s.today.words, 'palavra', 'palavras')}</div>
          <div className="muted small">
            {plural(s.today.dictations, 'ditado', 'ditados')} · {formatDuration(s.today.savedSeconds)} economizados
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Últimos 7 dias</div>
          <div className="usage-mid">{plural(s.week.words, 'palavra', 'palavras')}</div>
          <div className="muted small">
            {plural(s.week.dictations, 'ditado', 'ditados')} · {formatDuration(s.week.savedSeconds)} economizados
          </div>
        </div>
      </div>

      <h2>Últimos 30 dias</h2>
      <div className="card">
        <Columns
          items={s.daily.map((d, i) => ({
            key: d.day,
            value: d.words,
            tip: `${shortDay(d.day)}: ${plural(d.words, 'palavra', 'palavras')} em ${plural(d.dictations, 'ditado', 'ditados')}`,
            // De 7 em 7 dias, contando de hoje para trás.
            label: i === s.daily.length - 1 ? 'hoje' : (s.daily.length - 1 - i) % 7 === 0 ? shortDay(d.day) : '',
          }))}
        />
      </div>

      <h2>Próxima conquista</h2>
      <div className="card">
        {s.milestone.next ? (
          <>
            <div className="item-row">
              <span>
                Faltam <strong>{n(remaining)}</strong> palavras para <strong>{n(s.milestone.next)}</strong>
              </span>
              {s.milestone.reached && <span className="muted small">já passou de {n(s.milestone.reached)} 🎉</span>}
            </div>
            <div className="goal">
              <i style={{ width: `${Math.min(100, Math.max(2, progress))}%` }} />
            </div>
          </>
        ) : (
          <p>Você passou de 1 milhão de palavras ditadas. 🏆</p>
        )}
      </div>

      <div className="stat-pair">
        <div>
          <h2>Onde você mais dita</h2>
          <div className="card">
            {s.topApps.map((a) => (
              <div key={a.app} className="hbar" data-tip={`${a.app}: ${plural(a.words, 'palavra', 'palavras')} em ${plural(a.dictations, 'ditado', 'ditados')}`}>
                <div className="hbar-head">
                  <span>{a.app}</span>
                  <span className="muted small">{n(a.words)}</span>
                </div>
                <div className="hbar-track">
                  <i style={{ width: `${(a.words / maxApp) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2>Seus horários</h2>
          <div className="card">
            <Columns
              height={110}
              items={s.hours.map((w, h) => ({
                key: String(h),
                value: w,
                tip: `${h}h às ${h + 1}h: ${plural(w, 'palavra', 'palavras')}`,
                label: h % 6 === 0 ? `${h}h` : '',
              }))}
            />
            {s.hours[peakHour] > 0 && <p className="muted small stat-foot">Seu horário mais falante: {peakHour}h às {peakHour + 1}h.</p>}
          </div>
        </div>
      </div>

      <h2>Como você usa</h2>
      <div className="card stat-uses">
        <div>
          <div className="stat-label">Ditado</div>
          <div className="usage-mid">{n(s.modes.transcript)}</div>
        </div>
        <div>
          <div className="stat-label">Just Ask</div>
          <div className="usage-mid">{n(s.modes.ask)}</div>
          {s.modes.webSearches > 0 && <div className="muted small">{plural(s.modes.webSearches, 'busca', 'buscas')} na web</div>}
        </div>
        <div>
          <div className="stat-label">Tradução</div>
          <div className="usage-mid">{n(s.modes.translation)}</div>
        </div>
        <div>
          <div className="stat-label">Tempo falando</div>
          <div className="usage-mid">{formatDuration(s.totals.audioSeconds)}</div>
        </div>
      </div>

      <h2>Recordes</h2>
      <div className="card stat-uses">
        <div>
          <div className="stat-label">Maior ditado</div>
          <div className="usage-mid">{plural(s.longest.words, 'palavra', 'palavras')}</div>
          {s.longest.day && <div className="muted small">{longDay(s.longest.day)}</div>}
        </div>
        <div>
          <div className="stat-label">Melhor dia</div>
          <div className="usage-mid">{plural(s.bestDay.words, 'palavra', 'palavras')}</div>
          {s.bestDay.day && <div className="muted small">{longDay(s.bestDay.day)}</div>}
        </div>
        <div>
          <div className="stat-label">Maior sequência</div>
          <div className="usage-mid">{plural(s.streak.best, 'dia', 'dias')}</div>
        </div>
        <div>
          <div className="stat-label">Ditados no total</div>
          <div className="usage-mid">{n(s.totals.dictations)}</div>
        </div>
      </div>

      <h2>Ajustes</h2>
      <div className="card list">
        <div className="item">
          <div className="item-text">
            <div className="item-title">Sua velocidade de digitação</div>
            <div className="muted small">
              Base do "tempo economizado". A média de quem digita é perto de 40 palavras por minuto. Se você não sabe a sua, um teste de digitação de 1 minuto na internet mostra.
            </div>
          </div>
          <div className="item-control">
            <input
              className="num-input"
              type="number"
              min={MIN_TYPING_WPM}
              max={MAX_TYPING_WPM}
              value={wpm}
              onChange={(e) => setWpm(e.target.value)}
              onBlur={(e) => saveWpm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveWpm((e.target as HTMLInputElement).value)}
            />
            <span className="muted small">ppm</span>
          </div>
        </div>
        <div className="item">
          <div className="item-text">
            <div className="item-title">Zerar as estatísticas</div>
            <div className="muted small">
              Guardam só números e o nome do app, nunca o texto, e ficam neste PC. Apagar o histórico não zera as estatísticas. Isto zera.
            </div>
          </div>
          <div className="item-control">
            {confirmReset ? (
              <>
                <button className="secondary" onClick={() => setConfirmReset(false)}>
                  Cancelar
                </button>
                <button
                  className="secondary danger"
                  onClick={() => {
                    setConfirmReset(false)
                    void window.justSay.invoke(IPC.statsReset)
                  }}
                >
                  Zerar tudo
                </button>
              </>
            ) : (
              <button className="secondary danger" onClick={() => setConfirmReset(true)}>
                Zerar
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
