// Passo a passo da primeira abertura: microfone, atalho, um ditado de
// treino com contexto fictício e o Just Ask. Dá para pular a qualquer momento.
import { useEffect, useRef, useState } from 'react'
import { IPC, type KeyboardSnapshot } from '../../../../shared/ipc'
import { ONBOARDING_STEPS, PRACTICE_CHAT, type OnboardingState } from '../../../../shared/onboarding'
import type { AppSettings } from '../../../../shared/settings'
import { comboLabel } from '../../../../shared/shortcuts'
import { GroqKeySettings } from '../components/GroqKeySettings'
import { Keys } from '../components/Keys'

const api = () => window.justSay

export function Onboarding() {
  const [step, setStep] = useState(0)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [practiceText, setPracticeText] = useState('')

  useEffect(() => {
    void api().invoke<OnboardingState>(IPC.onboardingGet).then((s) => setStep(s.completedAt ? 0 : s.step))
    void api().invoke<AppSettings>(IPC.settingsGet).then(setSettings)
    return api().on(IPC.settingsChanged, (s) => setSettings(s as AppSettings))
  }, [])

  // O contexto fictício vale só nas telas de treino.
  useEffect(() => {
    const practice = ONBOARDING_STEPS[step] === 'ditado' || ONBOARDING_STEPS[step] === 'ask'
    void api().invoke(IPC.onboardingPractice, practice)
    return () => void api().invoke(IPC.onboardingPractice, false)
  }, [step])

  function go(next: number) {
    setStep(next)
    void api().invoke(IPC.onboardingSet, { step: next })
  }

  async function finish() {
    await api().invoke(IPC.onboardingSet, { completed: true, step: 0 })
    window.location.hash = '/dashboard'
  }

  const bindings = settings?.featureShortcutBindings
  const last = step === ONBOARDING_STEPS.length - 1

  return (
    <section className="onboarding">
      <div className="onb-top">
        <div className="onb-dots">
          {ONBOARDING_STEPS.map((s, i) => (
            <span key={s} className={i === step ? 'on' : i < step ? 'done' : ''} />
          ))}
        </div>
        <button className="link" onClick={() => void finish()}>
          Pular
        </button>
      </div>

      {ONBOARDING_STEPS[step] === 'chave' && <KeyStep onSaved={() => go(step + 1)} />}
      {ONBOARDING_STEPS[step] === 'microfone' && <MicStep />}
      {ONBOARDING_STEPS[step] === 'atalho' && bindings && <ShortcutStep keys={bindings.dictation} />}
      {ONBOARDING_STEPS[step] === 'ditado' && bindings && (
        <PracticeStep keys={bindings.dictation} text={practiceText} onText={setPracticeText} />
      )}
      {ONBOARDING_STEPS[step] === 'ask' && bindings && (
        <AskStep keys={bindings.askAnything} text={practiceText} onText={setPracticeText} />
      )}

      <div className="onb-nav">
        {step > 0 && (
          <button className="secondary" onClick={() => go(step - 1)}>
            Voltar
          </button>
        )}
        {last ? <button onClick={() => void finish()}>Concluir</button> : <button onClick={() => go(step + 1)}>Continuar</button>}
      </div>
    </section>
  )
}

/** Primeiro passo (D95): sem a chave do Groq, nada funciona. */
function KeyStep({ onSaved }: { onSaved: () => void }) {
  return (
    <div className="onb-step">
      <h1>Bem-vindo ao Just Say</h1>
      <p>Você fala, o Just Say escreve no campo onde o cursor está, em qualquer programa. Primeiro, a sua chave do Groq (grátis).</p>
      <GroqKeySettings onSaved={onSaved} />
    </div>
  )
}

function MicStep() {
  const [level, setLevel] = useState(0)
  const [state, setState] = useState<'idle' | 'testing' | 'heard' | 'error'>('idle')
  const stop = useRef<(() => void) | null>(null)

  useEffect(() => () => stop.current?.(), [])

  async function test() {
    stop.current?.()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Float32Array(analyser.fftSize)
      let peak = 0
      let raf = 0
      const loop = () => {
        analyser.getFloatTimeDomainData(data)
        let sum = 0
        for (const v of data) sum += v * v
        const rms = Math.sqrt(sum / data.length)
        peak = Math.max(peak, rms)
        setLevel(Math.min(1, rms * 8))
        raf = requestAnimationFrame(loop)
      }
      loop()
      setState('testing')
      const timer = setTimeout(() => {
        stop.current?.()
        setState(peak >= 0.01 ? 'heard' : 'error')
      }, 5000)
      stop.current = () => {
        clearTimeout(timer)
        cancelAnimationFrame(raf)
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close()
        setLevel(0)
        stop.current = null
      }
    } catch {
      setState('error')
    }
  }

  return (
    <div className="onb-step">
      <h1>O microfone</h1>
      <p>Agora, vamos ver se o Just Say ouve você.</p>
      <div className="card onb-card">
        <button onClick={() => void test()} disabled={state === 'testing'}>
          {state === 'testing' ? 'Fale alguma coisa…' : 'Testar o microfone'}
        </button>
        <div className="meter">
          <i style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
        {state === 'heard' && <p className="ok-text">Ouvi você. Tudo certo.</p>}
        {state === 'error' && (
          <p className="error small">
            Não ouvi nada. Veja se o microfone está ligado e escolha outro em Configurações → Áudio.
          </p>
        )}
      </div>
    </div>
  )
}

function ShortcutStep({ keys }: { keys: string[] }) {
  const [pressed, setPressed] = useState(false)

  // Enquanto esta tela está aberta, o atalho só é observado: nada é gravado.
  useEffect(() => {
    void api().invoke(IPC.shortcutCaptureStart)
    const off = api().on(IPC.globalKeyboard, (s) => {
      const pressing = (s as KeyboardSnapshot).pressingKeys
      if (keys.every((k) => pressing.includes(k))) setPressed(true)
    })
    return () => {
      off()
      void api().invoke(IPC.shortcutCaptureEnd)
    }
  }, [keys])

  return (
    <div className="onb-step">
      <h1>Seu atalho</h1>
      <p>
        Para ditar, <b>toque</b> <Keys keys={keys} /> uma vez para começar e outra para terminar. Não precisa segurar.
      </p>
      <div className="card onb-card">
        {pressed ? (
          <p className="ok-text">Isso! O Just Say reconheceu {comboLabel(keys)}.</p>
        ) : (
          <p className="muted">Toque {comboLabel(keys)} agora para testar.</p>
        )}
        <p className="muted small">Dá para trocar a tecla em Configurações → Atalhos. Esc cancela uma gravação.</p>
      </div>
    </div>
  )
}

function ChatCard() {
  return (
    <div className="chat-card">
      <div className="chat-head">
        {PRACTICE_CHAT.app} · <b>{PRACTICE_CHAT.channel}</b>
      </div>
      {PRACTICE_CHAT.messages.map((m, i) => (
        <div key={i} className="chat-msg">
          <b>{m.author}</b> {m.text}
        </div>
      ))}
    </div>
  )
}

function PracticeStep({ keys, text, onText }: { keys: string[]; text: string; onText: (t: string) => void }) {
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => box.current?.focus(), [])
  return (
    <div className="onb-step">
      <h1>Um ditado de treino</h1>
      <p>
        Imagine que você está nesta conversa. Clique na caixa, toque <Keys keys={keys} />, responda a Marina falando
        (por exemplo: "oi Marina, é, consigo sim, fica pronto até quinta, com a loja virtual") e toque de novo.
      </p>
      <ChatCard />
      <textarea
        ref={box}
        className="practice-box"
        value={text}
        placeholder="Sua resposta aparece aqui…"
        onChange={(e) => onText(e.target.value)}
      />
      {text.trim() && (
        <p className="ok-text">
          Pronto. Repare que as muletas sumiram e a pontuação veio certa. O app também leu a conversa para acertar o
          tom e os nomes.
        </p>
      )}
    </div>
  )
}

function AskStep({ keys, text, onText }: { keys: string[]; text: string; onText: (t: string) => void }) {
  return (
    <div className="onb-step">
      <h1>Just Ask</h1>
      <p>
        Selecione o texto da caixa, toque <Keys keys={keys} /> e peça uma mudança, como "deixa mais formal" ou "traduz
        para o inglês". Toque de novo para terminar. Sem seleção, dá para perguntar qualquer coisa: a resposta aparece num
        cartão.
      </p>
      <textarea
        className="practice-box"
        value={text}
        placeholder="Escreva ou dite algo aqui para testar…"
        onChange={(e) => onText(e.target.value)}
      />
      <p className="muted small">Também há a Tradução e o Histórico: estão no menu ao lado e em Configurações.</p>
    </div>
  )
}
