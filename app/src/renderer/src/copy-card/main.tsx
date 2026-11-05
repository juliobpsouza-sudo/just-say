import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IPC } from '../../../shared/ipc'
import './card.css'

function CopyCard() {
  const api = window.justSay
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void api.invoke<string>(IPC.copyCardGetText).then(setText)
    return api.on(IPC.copyCardText, (t) => {
      setText(String(t))
      setCopied(false)
    })
  }, [api])

  function copy() {
    api.send(IPC.copyCardCopy)
    setCopied(true)
    setTimeout(() => api.send(IPC.copyCardClose), 900)
  }

  return (
    <div className="card" onClick={copy} role="button">
      <div className="head">
        <span>{copied ? 'Copiado!' : 'O campo pode não ter recebido o texto'}</span>
        <button
          className="close"
          aria-label="Fechar"
          onClick={(e) => {
            e.stopPropagation()
            api.send(IPC.copyCardClose)
          }}
        >
          ×
        </button>
      </div>
      <p className="preview">{text}</p>
      <div className="hint">{copied ? 'Cole com Ctrl+V onde quiser.' : 'Clique para copiar'}</div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<CopyCard />)
