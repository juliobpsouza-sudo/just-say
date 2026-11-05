// Troca rápida de tema (`appearancePreference`): Sistema, Claro ou Escuro.
// O main aplica no `nativeTheme`, e todas as janelas mudam juntas.
import { useEffect, useState } from 'react'
import { IPC } from '../../../../shared/ipc'
import type { AppearancePreference, AppSettings } from '../../../../shared/settings'

const OPTIONS: { value: AppearancePreference; icon: string; label: string }[] = [
  { value: null, icon: '◐', label: 'Sistema' },
  { value: 'light', icon: '☀', label: 'Claro' },
  { value: 'dark', icon: '☾', label: 'Escuro' },
]

export function ThemeSwitch({ withLabels = false }: { withLabels?: boolean }) {
  const api = window.justSay
  const [value, setValue] = useState<AppearancePreference | undefined>(undefined)

  useEffect(() => {
    void api.invoke<AppSettings>(IPC.settingsGet).then((s) => setValue(s.appearancePreference))
    return api.on(IPC.settingsChanged, (s) => setValue((s as AppSettings).appearancePreference))
  }, [api])

  async function choose(v: AppearancePreference) {
    setValue(v)
    await api.invoke(IPC.settingsSet, 'appearancePreference', v)
  }

  return (
    <div className={`theme-switch ${withLabels ? 'labeled' : ''}`} role="radiogroup" aria-label="Tema">
      {OPTIONS.map((o) => (
        <button
          key={o.label}
          role="radio"
          aria-checked={value === o.value}
          title={o.label}
          className={value === o.value ? 'on' : ''}
          onClick={() => void choose(o.value)}
        >
          <span aria-hidden>{o.icon}</span>
          {withLabels && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  )
}
