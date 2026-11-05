// Logos coloridos das funções do Just Say (D84), no estilo aprovado dos "Usos populares"
// (D83): quadradinho com degradê e desenho branco, ou o logo reconhecível do serviço.
// Usados na aba Utilidades e na aba Conheça. Os ids dos degradês vêm do useId, para não
// colidirem quando o mesmo logo aparece duas vezes na tela.
import { useId } from 'react'

export type LogoKind =
  | 'dictation'
  | 'ask'
  | 'translate'
  | 'notion'
  | 'paste'
  | 'dictionary'
  | 'history'
  | 'privacy'
  | 'free'
  | 'anyApp'

/** Cor principal de cada logo, para o degradê e o brilho do cartão. */
export const LOGO_TONE: Record<LogoKind, string> = {
  dictation: '#7c5cff',
  ask: '#e05ad6',
  translate: '#19b35a',
  notion: '#9a9aab',
  paste: '#14b8a6',
  dictionary: '#ff9f1c',
  history: '#3b82f6',
  privacy: '#10b981',
  free: '#f59e0b',
  anyApp: '#6366f1',
}

const GRADIENT: Partial<Record<LogoKind, [string, string]>> = {
  dictation: ['#8b7cff', '#4f7cff'],
  ask: ['#f472b6', '#a855f7'],
  paste: ['#2dd4bf', '#059669'],
  dictionary: ['#ffd54a', '#ff8a1c'],
  history: ['#38bdf8', '#2563eb'],
  privacy: ['#34d399', '#047857'],
  free: ['#fde047', '#f59e0b'],
  anyApp: ['#818cf8', '#4f46e5'],
}

/** Desenho branco (traço) sobre o quadradinho com degradê. */
const GLYPH: Partial<Record<LogoKind, string>> = {
  dictation: 'M17 11.5a3 3 0 0 1 6 0v6a3 3 0 0 1 -6 0z M13.5 17a6.5 6.5 0 0 0 13 0 M20 23.5v4 M16.5 27.5h7',
  ask: 'M12 14a3 3 0 0 1 3 -3h10a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-6l-4.5 3.5v-3.5h-0.5a3 3 0 0 1 -3 -3z M20 15l1 2.2 2.2 1 -2.2 1 -1 2.2 -1 -2.2 -2.2 -1 2.2 -1z',
  paste: 'M16 12h-1.5a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h11a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-1.5 M16.5 10.5h7v3.5h-7z M16.5 19h7 M16.5 23h5',
  dictionary: 'M12 12.5a8 8 0 0 1 8 0a8 8 0 0 1 8 0v14a8 8 0 0 0 -8 0a8 8 0 0 0 -8 0z M20 12.5v14',
  history: 'M13 27v-6 M18 27v-11 M23 27v-8 M28 27v-14',
  privacy: 'M20 10.5a12 12 0 0 0 8 2.5a12 12 0 0 1 -8 15a12 12 0 0 1 -8 -15a12 12 0 0 0 8 -2.5 M16.5 19.5l2.5 2.5 4.5 -4.5',
  free: 'M20 11v18 M24.5 14.5c-.8 -1.6 -2.6 -2.5 -4.5 -2.5c-2.5 0 -4.5 1.5 -4.5 3.5s2 3 4.5 3.5s4.5 1.5 4.5 3.5s-2 3.5 -4.5 3.5c-2 0 -3.8 -.9 -4.6 -2.5',
  anyApp: 'M12 12h6v6h-6z M22 12h6v6h-6z M12 22h6v6h-6z M22 22h6v6h-6z',
}

function GradientTile({ kind }: { kind: LogoKind }) {
  const id = useId()
  const [a, b] = GRADIENT[kind]!
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="36" height="36" rx="10" fill={`url(#${id})`} />
      <path d={GLYPH[kind]} fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const Notion = (
  <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
    <rect x="3" y="3" width="34" height="34" rx="8" fill="#fff" stroke="#111" strokeWidth="2.5" />
    <path d="M13 11.5h3.2l8.4 12.3V11.5h2.9v17h-3.1l-8.5-12.4v12.4H13z" fill="#111" />
  </svg>
)

const Translate = (
  <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
    <g transform="translate(1 4)">
      <rect width="22" height="15" rx="3" fill="#009C3B" />
      <path d="M11 2.2L20 7.5 11 12.8 2 7.5z" fill="#FFDF00" />
      <circle cx="11" cy="7.5" r="3.4" fill="#002776" />
    </g>
    <g transform="translate(17 21)">
      <rect width="22" height="15" rx="3" fill="#fff" stroke="#e3e3ea" strokeWidth="0.6" />
      <path d="M0 3h22M0 7.5h22M0 12h22" stroke="#B22234" strokeWidth="2" />
      <rect width="9.5" height="8" rx="2" fill="#3C3B6E" />
    </g>
    <path d="M24 10.5h6a3 3 0 0 1 3 3v3" fill="none" stroke="#8b7cff" strokeWidth="2" strokeLinecap="round" />
    <path d="M30.5 14.5l2.5 2.5 2.5-2.5" fill="none" stroke="#8b7cff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export function AppLogo({ kind }: { kind: LogoKind }) {
  if (kind === 'notion') return Notion
  if (kind === 'translate') return Translate
  return <GradientTile kind={kind} />
}
