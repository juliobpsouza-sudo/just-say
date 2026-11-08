// Painel → Usos populares (D82, D83): cartões coloridos com um logo, o título e a frase para
// dizer. O "como fazer" (o que preparar e o atalho) abre na setinha.
// Para acrescentar um uso, ponha mais um item em USES (o modo diz qual atalho tocar).
import { useEffect, useState, type ReactNode } from 'react'
import { IPC } from '../../../../shared/ipc'
import type { AppSettings } from '../../../../shared/settings'
import type { ShortcutBindings } from '../../../../shared/shortcuts'
import { Keys } from './Keys'

type Mode = 'dictation' | 'askAnything' | 'translation'

interface Use {
  title: string
  logo: ReactNode
  /** Cor do cartão (fundo suave, borda e brilho ao passar o mouse). */
  tone: 'notion' | 'gmail' | 'idea' | 'translate' | 'screen' | 'search'
  mode: Mode
  /** O que fazer antes de tocar o atalho, se precisar. */
  before?: string
  say: string
}

const MODE_LABEL: Record<Mode, string> = { dictation: 'Ditado', askAnything: 'Just Ask', translation: 'Tradução' }

// ---------- logos (desenhos simples, sem arquivos de marca) ----------

const NotionLogo = (
  <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
    <rect x="3" y="3" width="34" height="34" rx="8" fill="#fff" stroke="#111" strokeWidth="2.5" />
    <path d="M13 11.5h3.2l8.4 12.3V11.5h2.9v17h-3.1l-8.5-12.4v12.4H13z" fill="#111" />
  </svg>
)

const GmailLogo = (
  <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
    <rect x="3" y="7" width="34" height="26" rx="5" fill="#fff" />
    <path d="M6 13v18h6V18z" fill="#4285F4" />
    <path d="M34 13v18h-6V18z" fill="#34A853" />
    <path d="M6 13l14 10.5L34 13v-1.5a3 3 0 0 0 -4.8 -2.4L20 16 10.8 9.1A3 3 0 0 0 6 11.5z" fill="#EA4335" />
    <path d="M28 18l6-5v-1.5a3 3 0 0 0 -4.8 -2.4L28 10z" fill="#FBBC04" />
    <path d="M6 13l6 5v-8l-1.2-.9A3 3 0 0 0 6 11.5z" fill="#C5221F" />
  </svg>
)

const IdeaLogo = (
  <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
    <defs>
      <linearGradient id="idea-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#FFD54A" />
        <stop offset="1" stopColor="#FF9F1C" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="36" height="36" rx="10" fill="url(#idea-g)" />
    <path d="M20 9a8 8 0 0 0 -4.6 14.5c.9.7 1.4 1.6 1.4 2.6V27h6.4v-.9c0-1 .5-1.9 1.4-2.6A8 8 0 0 0 20 9z" fill="#fff" />
    <rect x="16.8" y="28.5" width="6.4" height="2.6" rx="1.3" fill="#fff" />
    <path d="M17.5 18.5l2 2 3.5-4" fill="none" stroke="#FF9F1C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const TranslateLogo = (
  <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
    {/* Brasil */}
    <g transform="translate(1 4)">
      <rect width="22" height="15" rx="3" fill="#009C3B" />
      <path d="M11 2.2L20 7.5 11 12.8 2 7.5z" fill="#FFDF00" />
      <circle cx="11" cy="7.5" r="3.4" fill="#002776" />
    </g>
    {/* EUA */}
    <g transform="translate(17 21)">
      <rect width="22" height="15" rx="3" fill="#fff" stroke="#e3e3ea" strokeWidth="0.6" />
      <path d="M0 3h22M0 7.5h22M0 12h22" stroke="#B22234" strokeWidth="2" />
      <rect width="9.5" height="8" rx="2" fill="#3C3B6E" />
    </g>
    <path d="M24 10.5h6a3 3 0 0 1 3 3v3" fill="none" stroke="#8b7cff" strokeWidth="2" strokeLinecap="round" />
    <path d="M30.5 14.5l2.5 2.5 2.5-2.5" fill="none" stroke="#8b7cff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const ScreenLogo = (
  <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
    <defs>
      <linearGradient id="screen-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#8b7cff" />
        <stop offset="1" stopColor="#d65cf0" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="36" height="36" rx="10" fill="url(#screen-g)" />
    <path d="M10 13a3 3 0 0 1 3 -3h14a3 3 0 0 1 3 3v9a3 3 0 0 1 -3 3h-7l-5 4v-4h-2a3 3 0 0 1 -3 -3z" fill="#fff" />
    <path d="M17.6 15.4a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.2.9-1.2 1.6" fill="none" stroke="#a46cf5" strokeWidth="2" strokeLinecap="round" />
    <circle cx="20" cy="21.6" r="1.2" fill="#a46cf5" />
  </svg>
)

const SearchLogo = (
  <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
    <rect x="2" y="2" width="36" height="36" rx="10" fill="#fff" stroke="#e3e3ea" strokeWidth="1" />
    {/* "G" em quatro cores: arcos de um círculo de raio 9 */}
    <g fill="none" strokeWidth="4.2">
      <path d="M27.4 14.8A9 9 0 0 0 12.6 14.8" stroke="#EA4335" />
      <path d="M12.6 14.8A9 9 0 0 0 12.6 25.2" stroke="#FBBC05" />
      <path d="M12.6 25.2A9 9 0 0 0 27.6 24.6" stroke="#34A853" />
      <path d="M27.6 24.6A9 9 0 0 0 29 20H20.5" stroke="#4285F4" />
    </g>
  </svg>
)

const USES: Use[] = [
  {
    title: 'Guardar um vídeo no Notion',
    logo: NotionLogo,
    tone: 'notion',
    mode: 'askAnything',
    before: 'Com o vídeo aberto, toque',
    say: '"anota esse vídeo pra ver mais tarde"',
  },
  {
    title: 'Transformar pensamento em texto',
    logo: IdeaLogo,
    tone: 'idea',
    mode: 'askAnything',
    before: 'Dite do seu jeito, selecione o texto e toque',
    say: '"organiza isso em tópicos"',
  },
  {
    title: 'Escrever um e-mail inteiro',
    logo: GmailLogo,
    tone: 'gmail',
    mode: 'askAnything',
    before: 'No campo do e-mail, toque',
    say: '"escreve um e-mail pedindo o orçamento"',
  },
  {
    title: 'Falar português, sair inglês',
    logo: TranslateLogo,
    tone: 'translate',
    mode: 'translation',
    before: 'Em qualquer campo de texto, toque',
    say: 'Fale normalmente em português',
  },
  {
    title: 'Entender algo na tela',
    logo: ScreenLogo,
    tone: 'screen',
    mode: 'askAnything',
    before: 'Selecione um texto ou link e toque',
    say: '"o que é isso?"',
  },
  {
    title: 'Pesquisar sem abrir o navegador',
    logo: SearchLogo,
    tone: 'search',
    mode: 'askAnything',
    before: 'De qualquer lugar, toque',
    say: '"qual a cotação do dólar hoje?"',
  },
]

function UseCard({ use, bindings }: { use: Use; bindings: ShortcutBindings | null }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`use-card tone-${use.tone}${open ? ' open' : ''}`}>
      <div className="use-head">
        <span className="use-logo">{use.logo}</span>
        <span className="use-title">{use.title}</span>
      </div>
      <div className="use-say">{use.say}</div>
      <button className="use-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>Como fazer</span>
        <span className="use-chevron" aria-hidden />
      </button>
      {open && (
        <div className="use-how">
          {use.before && <div className="use-before">{use.before}</div>}
          <div className="use-keys">
            {bindings && <Keys keys={bindings[use.mode]} />}
            <span className="use-mode">{MODE_LABEL[use.mode]}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function PopularUses() {
  const [bindings, setBindings] = useState<ShortcutBindings | null>(null)

  useEffect(() => {
    void window.justSay.invoke<AppSettings>(IPC.settingsGet).then((s) => setBindings(s.featureShortcutBindings))
    return window.justSay.on(IPC.settingsChanged, (s) => setBindings((s as AppSettings).featureShortcutBindings))
  }, [])

  return (
    <div className="uses-grid">
      {USES.map((u) => (
        <UseCard key={u.title} use={u} bindings={bindings} />
      ))}
    </div>
  )
}
