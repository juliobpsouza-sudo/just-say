// SQLite do servidor (node:sqlite, sem build nativo): dicionário pessoal.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.ts'

const db = new DatabaseSync(join(config.dataDir, 'just-say.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS dictionary (
    id TEXT PRIMARY KEY,
    term TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_dictionary_term ON dictionary (lower(term));
`)

export type DictionarySource = 'manual' | 'auto'

export interface DictionaryEntry {
  id: string
  term: string
  source: DictionarySource
  created_at: string
  updated_at: string
}

export const MAX_TERM_LENGTH = 100

export function normalizeTerm(term: unknown): string | null {
  if (typeof term !== 'string') return null
  const t = term.trim().replace(/\s+/g, ' ')
  return t && t.length <= MAX_TERM_LENGTH ? t : null
}

export function listDictionary(): DictionaryEntry[] {
  return db.prepare('SELECT * FROM dictionary ORDER BY lower(term)').all() as unknown as DictionaryEntry[]
}

export function dictionaryTerms(): string[] {
  return listDictionary().map((e) => e.term)
}

export function findTerm(term: string): DictionaryEntry | undefined {
  return db.prepare('SELECT * FROM dictionary WHERE lower(term) = lower(?)').get(term) as DictionaryEntry | undefined
}

/** Adiciona (ou devolve o existente, se o termo já estiver lá). */
export function addTerm(term: string, source: DictionarySource = 'manual'): DictionaryEntry {
  const existing = findTerm(term)
  if (existing) return existing
  const now = new Date().toISOString()
  const entry: DictionaryEntry = { id: randomUUID(), term, source, created_at: now, updated_at: now }
  db.prepare('INSERT INTO dictionary (id, term, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    entry.id,
    entry.term,
    entry.source,
    entry.created_at,
    entry.updated_at,
  )
  return entry
}

export function updateTerm(id: string, term: string): DictionaryEntry | null {
  const clash = findTerm(term)
  if (clash && clash.id !== id) return null
  const now = new Date().toISOString()
  const res = db.prepare('UPDATE dictionary SET term = ?, updated_at = ? WHERE id = ?').run(term, now, id)
  if (res.changes === 0) return null
  return db.prepare('SELECT * FROM dictionary WHERE id = ?').get(id) as unknown as DictionaryEntry
}

export function deleteTerm(id: string): boolean {
  return db.prepare('DELETE FROM dictionary WHERE id = ?').run(id).changes > 0
}

// ---------- configurações simples (chave → valor JSON), Fase 7 ----------

db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setSetting(key: string, value: unknown): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  )
}

/** Importação em massa (CSV do Hub): adiciona os novos, ignora os repetidos. */
export function importTerms(terms: unknown[]): { added: number; skipped: number } {
  let added = 0
  let skipped = 0
  for (const raw of terms.slice(0, 5000)) {
    const term = normalizeTerm(raw)
    if (!term || findTerm(term)) {
      skipped++
      continue
    }
    addTerm(term, 'manual')
    added++
  }
  return { added, skipped }
}
