// Cartão de resposta do Ask Anything (entrega "reply"): pergunta, resposta em
// markdown e as fontes da busca. Links abrem no navegador pelo main (só http/https).
import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { IPC } from '../../../shared/ipc'
import { displayDomain } from '../../../shared/urls'
import { richFromMarkdown } from '../lib/richText'
import './card.css'

interface Payload {
  question: string
  answer: string
  sources: { title: string; url: string }[]
}

function AnswerCard() {
  const api = window.justSay
  const [data, setData] = useState<Payload | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void api.invoke<Payload | null>(IPC.answerCardGet).then(setData)
    const off = api.on(IPC.answerCardData, (p) => {
      setData(p as Payload)
      setCopied(false)
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') api.send(IPC.answerCardClose)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off()
      window.removeEventListener('keydown', onKey)
    }
  }, [api])

  const rich = useMemo(() => (data ? richFromMarkdown(data.answer) : null), [data])

  function copy() {
    if (!rich) return
    api.send(IPC.answerCardCopy, { text: rich.text, html: rich.html })
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Links dentro da resposta: nunca navegam a janela, abrem no navegador.
  function onAnswerClick(e: MouseEvent<HTMLDivElement>) {
    const link = (e.target as HTMLElement).closest('a')
    if (!link) return
    e.preventDefault()
    void api.invoke(IPC.openExternalUrl, link.getAttribute('href'))
  }

  return (
    <div className="card">
      <header className="head">
        <span className="brand">Just Say</span>
        <button className="close" aria-label="Fechar (Esc)" title="Fechar (Esc)" onClick={() => api.send(IPC.answerCardClose)}>
          ×
        </button>
      </header>

      {data?.question && <p className="question">“{data.question}”</p>}

      <div className="answer" onClick={onAnswerClick} dangerouslySetInnerHTML={{ __html: rich?.html ?? '' }} />

      {data && data.sources.length > 0 && (
        <section className="sources">
          <h2>Fontes</h2>
          <ol>
            {data.sources.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  title={s.url}
                  onClick={(e) => {
                    e.preventDefault()
                    void api.invoke(IPC.openExternalUrl, s.url)
                  }}
                >
                  {s.title || displayDomain(s.url)}
                </a>
                <span className="domain">{displayDomain(s.url)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <footer className="actions">
        <button className="primary" onClick={copy} disabled={!rich}>
          {copied ? 'Copiado!' : 'Copiar'}
        </button>
        <button onClick={() => api.send(IPC.answerCardClose)}>Fechar</button>
      </footer>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<AnswerCard />)
