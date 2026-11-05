// Dicionário pessoal: termos que a transcrição e o refino devem
// escrever certo. Adicionar, editar, apagar, importar CSV; os automáticos vêm das correções.
// Fica dentro de Configurações (D80); o título da seção vem de lá.
import { useCallback, useEffect, useState } from 'react'
import type { DictionaryEntry } from '../../../../shared/dictionary'
import { IPC } from '../../../../shared/ipc'

const api = () => window.justSay

type Result<T> = T | { error: string }
const isError = <T,>(r: Result<T>): r is { error: string } => typeof r === 'object' && r !== null && 'error' in r

export function Dictionary() {
  const [items, setItems] = useState<DictionaryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    const r = await api().invoke<Result<{ items: DictionaryEntry[] }>>(IPC.dictionaryList)
    if (isError(r)) setError(r.error)
    else {
      setError(null)
      setItems(r.items)
    }
  }, [])

  useEffect(() => {
    void load()
    return api().on(IPC.dictionaryChanged, () => void load())
  }, [load])

  function flash(msg: string) {
    setNotice(msg)
    setTimeout(() => setNotice(null), 4000)
  }

  async function add() {
    const term = draft.trim()
    if (!term) return
    const r = await api().invoke<Result<{ item: DictionaryEntry }>>(IPC.dictionaryAdd, term)
    if (isError(r)) return flash(r.error)
    setDraft('')
    await load()
  }

  async function importCsv() {
    const r = await api().invoke<Result<{ added: number; skipped: number }> | { canceled: true }>(IPC.dictionaryImportCsv)
    if ('canceled' in r) return
    if (isError(r)) return flash(r.error)
    flash(`${r.added} termo(s) importado(s)${r.skipped ? `, ${r.skipped} já estavam ou eram inválidos` : ''}.`)
    await load()
  }

  const shown = (items ?? []).filter((i) => i.term.toLowerCase().includes(filter.trim().toLowerCase()))
  const autoCount = (items ?? []).filter((i) => i.source === 'auto').length

  return (
    <div className="dictionary">
      <p className="muted context-line">
        Nomes, marcas e termos técnicos que você usa. A transcrição e o refino passam a escrever exatamente assim.
        Quando você corrige uma palavra depois de ditar, ela entra aqui sozinha (marcada como <b>automático</b>).
      </p>

      <div className="card list">
        <div className="item column">
          <div className="add-row">
            <input
              value={draft}
              placeholder="Novo termo (ex.: Figma, Kubernetes, Mariana)"
              maxLength={100}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
            />
            <button onClick={() => void add()}>Adicionar</button>
            <button className="secondary" onClick={() => void importCsv()}>
              Importar CSV
            </button>
          </div>
          <div className="muted small">CSV: um termo por linha (só a primeira coluna é lida).</div>
        </div>
      </div>
      {notice && <p className="small muted">{notice}</p>}
      {error && <p className="error small">{error}</p>}

      {items && items.length > 0 && (
        <>
          <div className="dict-tools">
            <input className="search" value={filter} placeholder="Filtrar…" onChange={(e) => setFilter(e.target.value)} />
            <span className="muted small">
              {items.length} termo(s){autoCount ? ` · ${autoCount} automático(s)` : ''}
            </span>
          </div>
          <div className="card list">
            {shown.map((entry) => (
              <TermRow key={entry.id} entry={entry} onChanged={load} onFlash={flash} />
            ))}
          </div>
        </>
      )}
      {items && items.length === 0 && <p className="muted">Nenhum termo ainda.</p>}
    </div>
  )
}

function TermRow({ entry, onChanged, onFlash }: { entry: DictionaryEntry; onChanged: () => Promise<void>; onFlash: (m: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(entry.term)

  async function save() {
    const term = value.trim()
    if (!term || term === entry.term) return setEditing(false)
    const r = await api().invoke<Result<{ item: DictionaryEntry }>>(IPC.dictionaryUpdate, entry.id, term)
    if (isError(r)) return onFlash(r.error)
    setEditing(false)
    await onChanged()
  }

  async function remove() {
    const r = await api().invoke<Result<{ deleted: boolean }>>(IPC.dictionaryDelete, entry.id)
    if (isError(r)) return onFlash(r.error)
    await onChanged()
  }

  return (
    <div className="item">
      <div className="item-text">
        {editing ? (
          <input
            className="inline-edit"
            value={value}
            autoFocus
            maxLength={100}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') {
                setValue(entry.term)
                setEditing(false)
              }
            }}
          />
        ) : (
          <span className="term">{entry.term}</span>
        )}
        {entry.source === 'auto' && <span className="badge auto">automático</span>}
      </div>
      <div className="item-control">
        {editing ? (
          <>
            <button onClick={() => void save()}>Salvar</button>
            <button className="secondary" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button className="link" onClick={() => setEditing(true)}>
              Editar
            </button>
            <button className="link danger" onClick={() => void remove()}>
              Apagar
            </button>
          </>
        )}
      </div>
    </div>
  )
}
