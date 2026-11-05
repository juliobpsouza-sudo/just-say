import { useEffect, useState } from 'react'
import { IPC } from '../../../shared/ipc'
import { Connectors } from './pages/Connectors'
import { Dashboard } from './pages/Dashboard'
import { History } from './pages/History'
import { Onboarding } from './pages/Onboarding'
import { Settings } from './pages/Settings'
import { Promo } from './pages/Promo'
import { Stats } from './pages/Stats'
import { Utilities } from './pages/Utilities'
import { ThemeSwitch } from './components/ThemeSwitch'

const ROUTES = [
  { path: '/dashboard', label: 'Painel' },
  { path: '/stats', label: 'Estatísticas' },
  { path: '/history', label: 'Histórico' },
  { path: '/connectors', label: 'Conectores' },
  { path: '/utilities', label: 'Utilidades' },
  { path: '/settings', label: 'Configurações' },
] as const

/** O passo a passo ocupa a janela inteira, sem o menu. O Conheça abre pelo brilho ao lado do nome. */
type Route = (typeof ROUTES)[number]['path'] | '/about' | '/onboarding'

function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash === '/onboarding') return '/onboarding'
  if (hash === '/about') return '/about'
  // O Dicionário mora em Configurações (D80); o endereço antigo leva até ele.
  if (hash === '/dictionary') return '/settings'
  return (ROUTES.find((r) => r.path === hash)?.path ?? '/dashboard') as Route
}

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute())

  useEffect(() => {
    const onHash = () => setRoute(currentRoute())
    window.addEventListener('hashchange', onHash)
    const off = window.justSay.on(IPC.hubNavigate, (r) => {
      window.location.hash = String(r)
    })
    return () => {
      window.removeEventListener('hashchange', onHash)
      off()
    }
  }, [])

  if (route === '/onboarding')
    return (
      <div className="hub onboarding-shell">
        <main className="content">
          <Onboarding />
        </main>
      </div>
    )

  return (
    <div className="hub">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          Just Say
          <a
            href="#/about"
            className={`brand-about ${route === '/about' ? 'active' : ''}`}
            title="Conheça o Just Say"
            aria-label="Conheça o Just Say"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <defs>
                <linearGradient id="brand-about-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#6d5df6" />
                  <stop offset="1" stopColor="#1fb8a6" />
                </linearGradient>
              </defs>
              <path
                className="spark-big"
                d="M10 6C10.7 10.6 13.4 13.3 18 14C13.4 14.7 10.7 17.4 10 22C9.3 17.4 6.6 14.7 2 14C6.6 13.3 9.3 10.6 10 6Z"
              />
              <path
                className="spark-small"
                d="M19 2C19.3 3.9 20.1 4.7 22 5C20.1 5.3 19.3 6.1 19 8C18.7 6.1 17.9 5.3 16 5C17.9 4.7 18.7 3.9 19 2Z"
              />
              <circle className="spark-dot" cx="20" cy="17" r="1.3" />
            </svg>
          </a>
        </div>
        {ROUTES.map((r) => (
          <a key={r.path} href={`#${r.path}`} className={route === r.path ? 'active' : ''}>
            {r.label}
          </a>
        ))}
        <div className="sidebar-bottom">
          <ThemeSwitch />
        </div>
      </nav>
      <main className="content">
        {route === '/dashboard' && <Dashboard />}
        {route === '/stats' && <Stats />}
        {route === '/history' && <History />}
        {route === '/connectors' && <Connectors />}
        {route === '/utilities' && <Utilities />}
        {route === '/about' && <Promo />}
        {route === '/settings' && <Settings />}
      </main>
    </div>
  )
}
