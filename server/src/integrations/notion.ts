// Integração com o Notion (D72): o Ask Anything anota vídeos, páginas e ideias numa "pasta"
// do Notion da pessoa. API oficial, versão 2026-03-11, sem SDK (só fetch).
// - Pasta = página ou banco de dados (data source) que a pessoa conectou à integração.
// - Banco de dados: cada nota vira uma linha (título, link e data, se houver essas colunas).
// - Página com itens de tarefa (☐): cada nota vira um item novo, com o título como link.
// - Página comum: cada nota vira uma subpágina com o link e o texto.
import { config } from '../config.ts'
import { getSetting, setSetting } from '../db.ts'

const API = 'https://api.notion.com/v1'
export const NOTION_VERSION = '2026-03-11'

export type FolderKind = 'data_source' | 'page'

export interface NotionFolder {
  id: string
  kind: FolderKind
  title: string
  url: string | null
}

export interface NoteInput {
  title: string
  url?: string | null
  text?: string | null
}

/** O que foi criado, para abrir e para desfazer. */
export interface NoteResult {
  folder: NotionFolder
  /** `page`: linha de banco ou subpágina (vai para a lixeira); `block`: item ☐ (é apagado). */
  kind: 'page' | 'block'
  id: string
  url: string | null
}

export class NotionError extends Error {
  constructor(
    readonly code: 'not_configured' | 'unauthorized' | 'not_found' | 'rate_limited' | 'unavailable' | 'bad_request',
    message: string,
  ) {
    super(message)
  }
}

export function notionConfigured(): boolean {
  return Boolean(config.notionToken)
}

async function notionFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!config.notionToken) throw new NotionError('not_configured', 'Falta a chave do Notion (NOTION_TOKEN) em server\\.env.')
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${config.notionToken}`,
        'Notion-Version': NOTION_VERSION,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new NotionError('unavailable', 'Não consegui falar com o Notion (sem internet?).')
  }
  const json = (await res.json().catch(() => ({}))) as T & { message?: string }
  if (res.ok) return json
  if (res.status === 401) throw new NotionError('unauthorized', 'O Notion recusou a chave. Confira o NOTION_TOKEN em server\\.env.')
  if (res.status === 404 || res.status === 403)
    throw new NotionError('not_found', 'O Notion não deixou acessar essa pasta. Conecte a página ao "Just Say" (⋯ → Conexões).')
  if (res.status === 429) throw new NotionError('rate_limited', 'O Notion pediu para esperar um pouco. Tente de novo.')
  throw new NotionError(res.status >= 500 ? 'unavailable' : 'bad_request', `Notion: ${json.message ?? `erro ${res.status}`}`)
}

// ---------- funções puras (testadas em tests/notion.test.ts) ----------

interface RichText {
  plain_text?: string
}

/** Resultado da busca → pasta. Linhas de banco (páginas dentro de um data source) não são pastas. */
export function folderFromSearchResult(r: Record<string, any>): NotionFolder | null {
  if (r?.object === 'data_source') {
    const title = ((r.title ?? []) as RichText[]).map((t) => t.plain_text ?? '').join('').trim()
    return { id: r.id, kind: 'data_source', title: title || 'Sem título', url: r.url ?? null }
  }
  if (r?.object === 'page') {
    const parentType = r.parent?.type
    if (parentType === 'data_source_id' || parentType === 'database_id') return null
    const titleProp = Object.values((r.properties ?? {}) as Record<string, any>).find((p) => p?.type === 'title')
    const title = ((titleProp?.title ?? []) as RichText[]).map((t) => t.plain_text ?? '').join('').trim()
    return { id: r.id, kind: 'page', title: title || 'Sem título', url: r.url ?? null }
  }
  return null
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const STOP = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'na', 'no', 'pra', 'para', 'pasta', 'lista', 'minha', 'meu', 'e', 'em'])

/** Palavras do pedido que não dizem nada sobre a pasta ("anota esse ... pra ver depois"). */
const GENERIC = new Set([
  'anota', 'anotar', 'anote', 'salva', 'salvar', 'salve', 'guarda', 'guardar', 'guarde', 'coloca', 'colocar', 'coloque',
  'bota', 'botar', 'adiciona', 'adicionar', 'esse', 'essa', 'esses', 'essas', 'isso', 'aqui', 'agora', 'depois', 'tarde',
  'mais', 'quero', 'notion', 'mim', 'favor',
])

/**
 * Sem pasta falada, a pasta pelo tipo de coisa (D90): "anota esse repositório" → "Repositórios
 * GitHub", "salva esse vídeo" → "Vídeos". Compara cada palavra do pedido (5+ letras, sem as
 * genéricas) com o começo das palavras do nome de cada pasta. Empate ou nada: null.
 */
export function folderFromCommand(folders: readonly NotionFolder[], command: string): NotionFolder | null {
  const words = [...new Set(fold(command).split(' '))].filter((w) => Array.from(w).length >= 5 && !STOP.has(w) && !GENERIC.has(w))
  let best: NotionFolder | null = null
  let bestScore = 0
  let tie = false
  for (const f of folders) {
    const title = fold(f.title).split(' ')
    const score = words.filter((w) => title.some((t) => t.startsWith(w.slice(0, Math.max(5, w.length - 2))))).length
    if (score > bestScore) {
      best = f
      bestScore = score
      tie = false
    } else if (score > 0 && score === bestScore) tie = true
  }
  return bestScore > 0 && !tie ? best : null
}

/**
 * Escolhe a pasta pelo nome falado ("assistir depois", "pra ver mais tarde" → "Vídeos para
 * assistir depois"). Sem nome, ou sem nenhuma parecida: a pasta padrão; sem padrão e com uma
 * pasta só: ela. Devolve null quando não dá para decidir.
 */
export function pickFolder(folders: readonly NotionFolder[], spoken: string | null | undefined, defaultId: string | null): NotionFolder | null {
  const hint = fold(spoken ?? '')
  if (hint) {
    const exact = folders.find((f) => fold(f.title) === hint)
    if (exact) return exact
    const words = hint.split(' ').filter((w) => w.length > 1 && !STOP.has(w))
    let best: { f: NotionFolder; score: number } | null = null
    for (const f of folders) {
      const title = fold(f.title)
      if (title.includes(hint) || (hint.length >= 4 && hint.includes(title))) return f
      const score = words.filter((w) => title.split(' ').some((t) => t.startsWith(w.slice(0, Math.max(4, w.length - 2))))).length
      if (score > 0 && (!best || score > best.score)) best = { f, score }
    }
    if (best) return best.f
  }
  const byDefault = defaultId ? folders.find((f) => f.id === defaultId) : undefined
  if (byDefault) return byDefault
  return folders.length === 1 ? folders[0] : null
}

/** "Vídeo X - YouTube" → "Vídeo X"; tira os sufixos de site comuns e o "(12)" de notificações. */
export function cleanPageTitle(title: string): string {
  return title
    .replace(/^\(\d+\)\s*/, '')
    .replace(/^GitHub\s+-\s+/i, '') // "GitHub - dono/repo: descrição" (D90)
    .replace(/(\s+[-–|·]\s+(YouTube|Google Chrome|Microsoft Edge|Mozilla Firefox|Brave|Opera))+$/i, '')
    .trim()
    .slice(0, 200)
}

interface SchemaProp {
  type?: string
}

/** Propriedades de uma linha nova: título, e link e data se o banco tiver colunas desses tipos. */
export function rowProperties(schema: Record<string, SchemaProp>, note: NoteInput, today: string): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  const entries = Object.entries(schema)
  const titleName = entries.find(([, p]) => p.type === 'title')?.[0] ?? 'Name'
  props[titleName] = { title: [{ text: { content: note.title.slice(0, 2000) } }] }
  const urlName = entries.find(([, p]) => p.type === 'url')?.[0]
  if (urlName && note.url) props[urlName] = { url: note.url }
  const dateName = entries.find(([, p]) => p.type === 'date')?.[0]
  if (dateName) props[dateName] = { date: { start: today } }
  return props
}

/** Conteúdo da nota (subpágina ou linha): o link com prévia e o texto. */
export function noteChildren(note: NoteInput): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = []
  if (note.url) blocks.push({ object: 'block', type: 'bookmark', bookmark: { url: note.url } })
  for (const para of (note.text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).slice(0, 50))
    blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: para.slice(0, 2000) } }] } })
  return blocks
}

/** Item ☐ de uma lista de tarefas: o título vira link (se houver), e o texto vem depois. */
export function todoBlock(note: NoteInput): Record<string, unknown> {
  const rich: Record<string, unknown>[] = [
    { type: 'text', text: { content: note.title.slice(0, 2000), ...(note.url ? { link: { url: note.url } } : {}) } },
  ]
  if (note.text?.trim()) rich.push({ type: 'text', text: { content: ` — ${note.text.trim().slice(0, 1500)}` } })
  return { object: 'block', type: 'to_do', to_do: { rich_text: rich, checked: false } }
}

// ---------- chamadas à API ----------

let foldersCache: { at: number; folders: NotionFolder[] } | null = null
const FOLDERS_TTL_MS = 60_000

/** Páginas e bancos que a pessoa conectou à integração (até 300). */
export async function listFolders(force = false): Promise<NotionFolder[]> {
  if (!force && foldersCache && Date.now() - foldersCache.at < FOLDERS_TTL_MS) return foldersCache.folders
  const out: NotionFolder[] = []
  let cursor: string | undefined
  for (let i = 0; i < 3; i++) {
    const res = await notionFetch<{ results: Record<string, any>[]; has_more: boolean; next_cursor: string | null }>('/search', {
      method: 'POST',
      body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
    })
    for (const r of res.results) {
      const f = folderFromSearchResult(r)
      if (f) out.push(f)
    }
    if (!res.has_more || !res.next_cursor) break
    cursor = res.next_cursor
  }
  foldersCache = { at: Date.now(), folders: out }
  return out
}

export function defaultFolderId(): string | null {
  return getSetting<string | null>('notion_default_folder', null)
}

export function setDefaultFolderId(id: string | null): void {
  setSetting('notion_default_folder', id)
}

/** A página tem itens de tarefa (☐)? Então a nota entra como item, não como subpágina. */
async function pageHasTodos(pageId: string): Promise<boolean> {
  const res = await notionFetch<{ results: { type?: string }[] }>(`/blocks/${pageId}/children?page_size=100`)
  return res.results.some((b) => b.type === 'to_do')
}

export async function createNote(folder: NotionFolder, note: NoteInput, today = new Date().toISOString().slice(0, 10)): Promise<NoteResult> {
  if (folder.kind === 'data_source') {
    const ds = await notionFetch<{ properties: Record<string, SchemaProp> }>(`/data_sources/${folder.id}`)
    const children = noteChildren(note)
    const page = await notionFetch<{ id: string; url?: string }>('/pages', {
      method: 'POST',
      body: {
        parent: { type: 'data_source_id', data_source_id: folder.id },
        properties: rowProperties(ds.properties ?? {}, note, today),
        ...(children.length ? { children } : {}),
      },
    })
    return { folder, kind: 'page', id: page.id, url: page.url ?? null }
  }
  if (await pageHasTodos(folder.id)) {
    const res = await notionFetch<{ results: { id: string }[] }>(`/blocks/${folder.id}/children`, {
      method: 'PATCH',
      body: { children: [todoBlock(note)], position: { type: 'end' } },
    })
    return { folder, kind: 'block', id: res.results[0]?.id ?? '', url: folder.url }
  }
  const children = noteChildren(note)
  const page = await notionFetch<{ id: string; url?: string }>('/pages', {
    method: 'POST',
    body: {
      parent: { type: 'page_id', page_id: folder.id },
      properties: { title: { title: [{ text: { content: note.title.slice(0, 2000) } }] } },
      ...(children.length ? { children } : {}),
    },
  })
  return { folder, kind: 'page', id: page.id, url: page.url ?? null }
}

/** Desfazer: linha ou subpágina vai para a lixeira do Notion; item ☐ é apagado. */
export async function undoNote(kind: 'page' | 'block', id: string): Promise<void> {
  if (!/^[0-9a-f-]{32,36}$/i.test(id)) throw new NotionError('bad_request', 'id inválido')
  if (kind === 'page') await notionFetch(`/pages/${id}`, { method: 'PATCH', body: { in_trash: true } })
  else await notionFetch(`/blocks/${id}`, { method: 'DELETE' })
}
