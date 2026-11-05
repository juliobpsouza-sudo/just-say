// Configurações: aparência, atalhos, idiomas, tradução, dicionário, aprendizado e histórico, privacidade, áudio, modelos e
// passo a passo. O Notion fica na aba Conectores (D77).
import { useCallback, useEffect, useRef, useState } from 'react'
import { IPC, type KeyboardSnapshot } from '../../../../shared/ipc'
import type { AppSettings } from '../../../../shared/settings'
import {
  captureReducer,
  EMPTY_CAPTURE,
  FEATURE_LABELS,
  SHORTCUT_FEATURES,
  type CaptureState,
  type ShortcutBindings,
  type ShortcutFeature,
} from '../../../../shared/shortcuts'
import { AudioSettings } from '../components/AudioSettings'
import { GroqKeySettings } from '../components/GroqKeySettings'
import { Keys } from '../components/Keys'
import { ModelsSettings } from '../components/ModelsSettings'
import { PrivacySettings } from '../components/PrivacySettings'
import { TranslationSettings } from '../components/TranslationSettings'
import { ThemeSwitch } from '../components/ThemeSwitch'
import { LanguagesSettings } from '../components/LanguagesSettings'
import { LearningSettings } from '../components/LearningSettings'
import { Dictionary } from './Dictionary'

const api = () => window.justSay

export function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const bindings: ShortcutBindings | null = settings?.featureShortcutBindings ?? null

  const reload = useCallback(async () => {
    setSettings(await api().invoke<AppSettings>(IPC.settingsGet))
  }, [])

  useEffect(() => {
    void reload()
    return api().on(IPC.settingsChanged, (s) => setSettings(s as AppSettings))
  }, [reload])

  // Vindo de #/dictionary: rola até a seção do Dicionário.
  useEffect(() => {
    if (window.location.hash === '#/dictionary')
      setTimeout(() => document.getElementById('settings-dictionary')?.scrollIntoView({ block: 'start' }), 50)
  }, [])

  async function resetAll() {
    setSettings(await api().invoke<AppSettings>(IPC.settingsResetShortcuts))
  }

  return (
    <section>
      <h1>Configurações</h1>
      <h2 id="settings-groq-key">Chave do Groq</h2>
      <GroqKeySettings />

      <h2>Aparência</h2>
      <div className="card list">
        <div className="item">
          <div className="item-text">
            <div className="item-title">Tema</div>
            <div className="muted small">Sistema segue o modo claro ou escuro do Windows. Também dá para trocar no canto do menu.</div>
          </div>
          <ThemeSwitch withLabels />
        </div>
        <div className="item">
          <div className="item-text">
            <div className="item-title">Modo técnico</div>
            <div className="muted small">Mostra no Painel o monitor ao vivo e a lista de transições. Serve para testar o app; no dia a dia pode ficar desligado.</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings?.showTechnicalMonitor ?? false}
              onChange={(e) =>
                void api()
                  .invoke<{ settings: AppSettings }>(IPC.settingsSet, 'showTechnicalMonitor', e.target.checked)
                  .then((r) => setSettings(r.settings))
              }
            />
            <span>{settings?.showTechnicalMonitor ? 'ligado' : 'desligado'}</span>
          </label>
        </div>
      </div>

      <h2>Inicialização</h2>
      <div className="card list">
        <div className="item">
          <div className="item-text">
            <div className="item-title">Abrir com o Windows</div>
            <div className="muted small">
              O Just Say abre sozinho quando você liga o PC, sem mostrar janela: fica só o ícone na bandeja e os atalhos
              já funcionam.
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings?.launchAtSystemStartup ?? false}
              onChange={(e) =>
                void api()
                  .invoke<{ settings: AppSettings }>(IPC.settingsSet, 'launchAtSystemStartup', e.target.checked)
                  .then((r) => setSettings(r.settings))
              }
            />
            <span>{settings?.launchAtSystemStartup ? 'ligado' : 'desligado'}</span>
          </label>
        </div>
      </div>

      <h2>Atalhos</h2>
      <p className="muted">
        Clique em <b>Alterar</b>, aperte a combinação nova e solte as teclas. Vale qualquer tecla do teclado e os
        botões do meio e laterais do mouse.
      </p>
      {bindings && (
        <div className="card list">
          {SHORTCUT_FEATURES.map((feature) => (
            <ShortcutRow key={feature} feature={feature} keys={bindings[feature]} onSaved={reload} />
          ))}
        </div>
      )}
      <div className="row-actions">
        <button className="secondary" onClick={() => void resetAll()}>
          Restaurar os atalhos padrão
        </button>
      </div>
      <p className="muted small">
        Num teclado ABNT2, o Alt direito é o AltGr. Com ele como atalho de ditado, AltGr+Q (/) e AltGr+W (?)
        continuam funcionando, mas iniciam e cancelam uma gravação no caminho. Se você usa muito o AltGr, prefira
        outra tecla, como Pause, Insert, F13 ou um botão lateral do mouse.
      </p>

      <h2>Idiomas do ditado</h2>
      {settings && <LanguagesSettings settings={settings} onChange={setSettings} />}

      <h2>Tradução</h2>
      {settings && <TranslationSettings settings={settings} onChange={setSettings} />}

      <h2 id="settings-dictionary">Dicionário</h2>
      <Dictionary />

      <h2>Aprendizado e histórico</h2>
      {settings && <LearningSettings settings={settings} onChange={setSettings} />}

      <h2>Privacidade</h2>
      {settings && <PrivacySettings settings={settings} onChange={setSettings} />}

      <h2>Áudio</h2>
      {settings && <AudioSettings settings={settings} onChange={setSettings} />}

      <h2>Modelos</h2>
      <ModelsSettings />

      <h2>Passo a passo</h2>
      <div className="card list">
        <div className="item">
          <div className="item-text">
            <div className="item-title">Rever o passo a passo</div>
            <div className="muted small">Microfone, atalho, um ditado de treino e o Ask Anything, em 4 telas.</div>
          </div>
          <button className="secondary" onClick={() => (window.location.hash = '/onboarding')}>
            Abrir
          </button>
        </div>
      </div>
    </section>
  )
}

function ShortcutRow({
  feature,
  keys,
  onSaved,
}: {
  feature: ShortcutFeature
  keys: string[]
  onSaved: () => void
}) {
  const [capturing, setCapturing] = useState(false)
  const [capture, setCapture] = useState<CaptureState>(EMPTY_CAPTURE)
  const [errors, setErrors] = useState<string[]>([])
  const captureRef = useRef(capture)
  captureRef.current = capture

  // Enquanto captura: ouve o hook global e impede que as teclas acionem botões desta janela.
  useEffect(() => {
    if (!capturing) return
    void api().invoke(IPC.shortcutCaptureStart)
    ;(document.activeElement as HTMLElement | null)?.blur()
    const block = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', block, true)
    window.addEventListener('keyup', block, true)
    const off = api().on(IPC.globalKeyboard, (s) => {
      setCapture((prev) => captureReducer(prev, (s as KeyboardSnapshot).pressingKeys))
    })
    return () => {
      off()
      window.removeEventListener('keydown', block, true)
      window.removeEventListener('keyup', block, true)
      void api().invoke(IPC.shortcutCaptureEnd)
    }
  }, [capturing])

  function begin() {
    setErrors([])
    setCapture(EMPTY_CAPTURE)
    setCapturing(true)
  }

  function cancel() {
    setCapturing(false)
    setCapture(EMPTY_CAPTURE)
  }

  async function save() {
    if (!capture.result) return
    const result = await api().invoke<string[]>(IPC.settingsSetShortcut, feature, capture.result)
    if (result.length > 0) {
      setErrors(result)
      setCapture(EMPTY_CAPTURE)
      return
    }
    setCapturing(false)
    setCapture(EMPTY_CAPTURE)
    onSaved()
  }

  const info = FEATURE_LABELS[feature]
  return (
    <div className={`item ${capturing ? 'capturing' : ''}`}>
      <div className="item-text">
        <div className="item-title">{info.title}</div>
        <div className="muted small">{info.hint}</div>
        {errors.map((e) => (
          <div key={e} className="error small">
            {e}
          </div>
        ))}
      </div>
      <div className="item-control">
        {!capturing && (
          <>
            <Keys keys={keys} />
            <button onClick={begin}>Alterar</button>
          </>
        )}
        {capturing && !capture.result && (
          <>
            <span className="listening">
              {capture.peak.length ? <Keys keys={capture.peak} /> : 'Aperte a combinação nova…'}
            </span>
            <button className="secondary" onMouseDown={cancel}>
              Cancelar
            </button>
          </>
        )}
        {capturing && capture.result && (
          <>
            <Keys keys={capture.result} />
            <button onMouseDown={() => void save()}>Salvar</button>
            <button className="secondary" onMouseDown={begin}>
              De novo
            </button>
            <button className="secondary" onMouseDown={cancel}>
              Cancelar
            </button>
          </>
        )}
      </div>
    </div>
  )
}
