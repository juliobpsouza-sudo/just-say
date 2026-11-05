// Conectores (D77): os serviços que o Ask Anything pode usar. Hoje o Notion; a Google Agenda
// é a próxima meta e aparece como "Em breve".
import { ConnectorCard } from '../components/ConnectorCard'
import { NotionSettings } from '../components/NotionSettings'

const CALENDAR = (
  <span className="conn-logo calendar" aria-hidden>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z M16 3v4 M8 3v4 M4 11h16 M11 15h1 M12 15v3" />
    </svg>
  </span>
)

export function Connectors() {
  return (
    <section>
      <h1>Conectores</h1>
      <p className="muted context-line">
        Serviços que o <b>Ask Anything</b> pode usar por voz. As chaves ficam só neste PC, no <code>server\.env</code>, nunca
        no app nem na nuvem.
      </p>

      <h2>Seus conectores</h2>
      <NotionSettings />

      <h2>Em breve</h2>
      <ConnectorCard
        logo={CALENDAR}
        name="Google Agenda"
        description='Marca eventos por voz: "marca dentista sexta às 15h".'
        status="soon"
      />
    </section>
  )
}
