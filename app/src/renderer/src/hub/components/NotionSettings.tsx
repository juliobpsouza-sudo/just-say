// Conectores → Notion (D72, D77): status da conexão, pastas encontradas e a pasta padrão.
import { useEffect, useState } from 'react'
import { IPC } from '../../../../shared/ipc'
import { ConnectorCard, type ConnectorStatus } from './ConnectorCard'

interface Folder {
  id: string
  kind: 'data_source' | 'page'
  title: string
  url: string | null
}

interface NotionView {
  configured: boolean
  folders: Folder[]
  default_folder_id: string | null
  error: string | null
}

type Result<T> = T | { error: string }

export function NotionSettings() {
  const api = window.justSay
  const [view, setView] = useState<NotionView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load(channel: string, ...args: unknown[]) {
    setBusy(true)
    const r = await api.invoke<Result<NotionView>>(channel, ...args)
    setBusy(false)
    // O servidor fora do ar chega como { error } sem `configured`.
    if ('configured' in r) {
      setView(r)
      setError(r.error)
    } else setError(r.error)
  }

  useEffect(() => {
    void load(IPC.notionGet)
  }, [])

  const folders = view?.folders ?? []
  const status: ConnectorStatus = !view ? 'loading' : !view.configured ? 'off' : error ? 'error' : 'on'

  return (
    <ConnectorCard
      logo={<span className="conn-logo notion">N</span>}
      name="Notion"
      description="Anota vídeos, links e ideias nas suas páginas e listas do Notion."
      status={status}
    >
      <p className="muted small conn-howto">
        Com o <b>Ask Anything</b>, diga "anota esse vídeo pra ver mais tarde" ou "anota na pasta Ideias: …". O vídeo ou a
        página aberta vira uma linha (ou um item ☐) na pasta, com o link. A barra mostra <b>Abrir</b> e <b>Desfazer</b>.
      </p>

      {view && !view.configured && (
        <ol className="small steps">
          <li>
            Abra <b>notion.so → Configurações → Conexões → Desenvolver ou gerenciar integrações</b> e crie uma integração
            interna chamada "Just Say". Copie a chave.
          </li>
          <li>
            Cole a chave no arquivo <code>server\.env</code>, numa linha <code>NOTION_TOKEN=…</code>. Não mande a chave por
            chat.
          </li>
          <li>
            No Notion, em cada página ou lista que vai receber notas, abra <b>⋯ → Conexões → Just Say</b>.
          </li>
          <li>Feche e abra o Just Say de novo.</li>
        </ol>
      )}

      {error && <div className="error small">{error}</div>}

      {view?.configured && (
        <>
          <div className="conn-field">
            <div className="item-title small">Pastas que o Just Say vê</div>
            <div className="muted small">
              {folders.length
                ? 'Só aparecem as páginas conectadas a ele.'
                : 'Nenhuma página conectada ainda: no Notion, abra ⋯ → Conexões → Just Say na página da pasta.'}
            </div>
            {folders.length > 0 && (
              <div className="chips">
                {folders.map((f) => (
                  <span key={f.id} className="chip" title={f.kind === 'data_source' ? 'Banco de dados (cada nota vira uma linha)' : 'Página'}>
                    {f.kind === 'data_source' ? '▦' : '▢'} {f.title}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="item-row conn-field">
            <div className="item-text">
              <div className="item-title small">Pasta padrão</div>
              <div className="muted small">Usada quando você não diz o nome da pasta.</div>
            </div>
            <select
              className="select"
              value={view.default_folder_id ?? ''}
              disabled={busy || folders.length === 0}
              onChange={(e) => void load(IPC.notionSetDefault, e.target.value || null)}
            >
              <option value="">{folders.length === 1 ? `(a única: ${folders[0].title})` : 'Nenhuma'}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
          </div>
          <div className="conn-actions">
            <button className="secondary" disabled={busy} onClick={() => void load(IPC.notionRefresh)}>
              {busy ? 'Procurando…' : 'Procurar as pastas de novo'}
            </button>
          </div>
        </>
      )}
    </ConnectorCard>
  )
}
