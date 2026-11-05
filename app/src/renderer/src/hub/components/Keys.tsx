import { keyLabel, normalizeCombo } from '../../../../shared/shortcuts'

export function Keys({ keys, empty = '—' }: { keys: readonly string[]; empty?: string }) {
  if (keys.length === 0) return <span className="muted">{empty}</span>
  return (
    <span className="keys">
      {normalizeCombo(keys).map((k, i) => (
        <span key={k}>
          {i > 0 && <span className="plus">+</span>}
          <kbd>{keyLabel(k)}</kbd>
        </span>
      ))}
    </span>
  )
}
