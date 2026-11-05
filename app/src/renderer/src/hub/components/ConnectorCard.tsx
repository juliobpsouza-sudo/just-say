// Cartão de um conector (D77): logo, nome, descrição e estado no topo; o conteúdo embaixo.
import type { ReactNode } from 'react'

export type ConnectorStatus = 'on' | 'off' | 'error' | 'loading' | 'soon'

const STATUS: Record<ConnectorStatus, { label: string; tone: string }> = {
  on: { label: 'Conectado', tone: 'ok' },
  off: { label: 'Não conectado', tone: 'muted' },
  error: { label: 'Com erro', tone: 'bad' },
  loading: { label: 'Verificando…', tone: 'muted' },
  soon: { label: 'Em breve', tone: 'soon' },
}

export function ConnectorCard({
  logo,
  name,
  description,
  status,
  children,
}: {
  logo: ReactNode
  name: string
  description: string
  status: ConnectorStatus
  children?: ReactNode
}) {
  const s = STATUS[status]
  return (
    <div className={`card connector${status === 'soon' ? ' soon' : ''}`}>
      <div className="conn-head">
        {logo}
        <div className="conn-text">
          <div className="conn-name">{name}</div>
          <div className="muted small">{description}</div>
        </div>
        <span className={`conn-status ${s.tone}`}>
          <span className="dot" aria-hidden />
          {s.label}
        </span>
      </div>
      {children && <div className="conn-body">{children}</div>}
    </div>
  )
}
