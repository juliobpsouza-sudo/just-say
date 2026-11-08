// Conheça (D84): a página de apresentação do Just Say, no estilo aprovado dos "Usos
// populares" (D83). Os números vêm das Estatísticas da própria pessoa.
import { AppLogo, LOGO_TONE, type LogoKind } from '../components/AppLogos'
import { formatDuration } from '../../../../shared/stats'
import { useStats } from './Stats'

const nf = new Intl.NumberFormat('pt-BR')

const FEATURES: { kind: LogoKind; title: string; text: string }[] = [
  { kind: 'dictation', title: 'Ditado', text: 'Sem "é", "tipo" e "né", com pontuação e no tom do app onde você está.' },
  { kind: 'ask', title: 'Just Ask', text: 'Pergunte, peça um e-mail, resuma um texto ou busque na internet.' },
  { kind: 'translate', title: 'Tradução', text: 'Fale em português e o texto já entra em inglês.' },
  { kind: 'notion', title: 'Notion', text: 'Guarde vídeos, links e ideias nas suas listas, por voz.' },
  { kind: 'dictionary', title: 'Aprende com você', text: 'Nomes, gírias e o seu jeito de escrever ficam cada vez mais certos.' },
  { kind: 'anyApp', title: 'Entende onde você está', text: 'Olha o app e a conversa na tela para acertar nomes e o tom.' },
]

const TRUST: { kind: LogoKind; title: string; text: string }[] = [
  { kind: 'history', title: 'Seu histórico é seu', text: 'Tudo o que você dita fica só no seu PC.' },
  { kind: 'privacy', title: 'Você manda na tela', text: 'Escolha onde ele pode ler. WhatsApp e Telegram vêm bloqueados.' },
  { kind: 'free', title: 'De graça', text: 'Sem assinatura e sem cartão.' },
]

/** Onda de som animada do topo. */
function Wave() {
  return (
    <div className="promo-wave" aria-hidden>
      {Array.from({ length: 24 }, (_, i) => (
        <i key={i} style={{ animationDelay: `${(i * 0.09) % 1.1}s` }} />
      ))}
    </div>
  )
}

export function Promo() {
  const s = useStats()
  const times = s?.speakingWpm ? Math.max(1, Math.round((s.speakingWpm / s.typingWpm) * 10) / 10) : 3
  const hasStats = Boolean(s && s.totals.dictations > 0)

  return (
    <section className="promo">
      <div className="promo-hero">
        <Wave />
        <h1 className="promo-title">
          Fale. <span>Ele escreve.</span>
        </h1>
        <p className="promo-sub">
          Ditado com IA em qualquer programa do Windows. Você fala do seu jeito, e o texto sai limpo, pontuado e pronto, onde o
          cursor estiver.
        </p>
        <div className="promo-cta">
          <a className="promo-btn primary" href="#/onboarding">
            Fazer o passo a passo
          </a>
          <a className="promo-btn" href="#/utilities">
            Ver tudo o que ele faz
          </a>
        </div>
      </div>

      <div className="promo-numbers">
        <div className="promo-number" style={{ ['--tone' as string]: LOGO_TONE.dictation }}>
          <div className="promo-big">{nf.format(times)}×</div>
          <div className="promo-label">mais rápido que digitar</div>
          {s?.speakingWpm && (
            <div className="promo-note">
              você fala a {s.speakingWpm} palavras por minuto, contra {s.typingWpm} digitando
            </div>
          )}
        </div>
        <div className="promo-number" style={{ ['--tone' as string]: LOGO_TONE.free }}>
          <div className="promo-big">R$ 0</div>
          <div className="promo-label">sem assinatura, sem cartão</div>
        </div>
        <div className="promo-number" style={{ ['--tone' as string]: LOGO_TONE.anyApp }}>
          <div className="promo-big long">Qualquer app</div>
          <div className="promo-label">WhatsApp, Gmail, Notion, Claude, VS Code…</div>
        </div>
      </div>

      <h2 className="promo-h2">Antes e depois</h2>
      <div className="promo-ba">
        <div className="promo-ba-card said">
          <div className="promo-ba-tag">Você fala</div>
          <p>
            <s>é…</s> <s>tipo,</s> amanhã eu chego <s>às oito, não,</s> às nove, beleza?
          </p>
        </div>
        <div className="promo-ba-arrow" aria-hidden>
          →
        </div>
        <div className="promo-ba-card written">
          <div className="promo-ba-tag">Sai escrito</div>
          <p>Amanhã eu chego às nove, beleza?</p>
        </div>
      </div>

      <h2 className="promo-h2">Como funciona</h2>
      <div className="promo-steps">
        {[
          ['Toque no atalho', 'Uma vez, sem segurar.'],
          ['Fale normalmente', 'Do seu jeito, até se corrigindo no meio.'],
          ['Pronto', 'O texto aparece onde está o cursor.'],
        ].map(([title, text], i) => (
          <div key={title} className="promo-step">
            <span className="promo-step-n">{i + 1}</span>
            <div>
              <div className="promo-step-title">{title}</div>
              <div className="promo-step-text">{text}</div>
            </div>
          </div>
        ))}
      </div>

      <h2 className="promo-h2">O que ele faz</h2>
      <div className="promo-features">
        {FEATURES.map((f) => (
          <div key={f.title} className="promo-feature" style={{ ['--tone' as string]: LOGO_TONE[f.kind] }}>
            <span className="promo-logo">
              <AppLogo kind={f.kind} />
            </span>
            <div className="promo-feature-title">{f.title}</div>
            <div className="promo-feature-text">{f.text}</div>
          </div>
        ))}
      </div>

      <h2 className="promo-h2">Pode confiar</h2>
      <div className="promo-trust">
        {TRUST.map((t) => (
          <div key={t.title} className="promo-trust-item" style={{ ['--tone' as string]: LOGO_TONE[t.kind] }}>
            <span className="promo-logo small">
              <AppLogo kind={t.kind} />
            </span>
            <div>
              <div className="promo-feature-title">{t.title}</div>
              <div className="promo-feature-text">{t.text}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="promo-final">
        {hasStats && s ? (
          <>
            <div className="promo-final-label">Até agora, com o Just Say, você já economizou</div>
            <div className="promo-final-big">{formatDuration(s.totals.savedSeconds)}</div>
            <div className="promo-final-note">
              {nf.format(s.totals.words)} palavras ditadas em {nf.format(s.totals.dictations)} ditados.
            </div>
          </>
        ) : (
          <>
            <div className="promo-final-label">Seu primeiro ditado está a um toque de distância</div>
            <div className="promo-final-big">Experimente agora</div>
          </>
        )}
        <a className="promo-btn primary" href="#/stats">
          Ver minhas estatísticas
        </a>
      </div>
    </section>
  )
}
