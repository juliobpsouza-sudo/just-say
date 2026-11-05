// Banco local do histórico: SQLite embutido no Electron (`node:sqlite`, D62), tabela
// `history_v2` com migrações numeradas e busca por FTS5.
// A classe recebe o banco aberto: os testes usam um banco em memória.
import type { DatabaseSync } from 'node:sqlite'
import { ftsQuery, type HistoryQuery, type HistoryRow } from '../../shared/history'
import { statsEventFrom, type StatsEvent } from '../../shared/stats'

/** Migrações em ordem. Nunca editar uma que já rodou: só acrescentar. */
export const MIGRATIONS: readonly string[] = [
  // 1. history_v2 + extensões do Just Say + busca
  `
  CREATE TABLE history_v2 (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local',
    status TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'voice_transcript',
    refined_text TEXT,
    duration REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    server_updated_at INTEGER,
    sync_status TEXT NOT NULL DEFAULT 'local_only',
    sync_attempt_count INTEGER NOT NULL DEFAULT 0,
    synced_from_cloud INTEGER NOT NULL DEFAULT 0,
    audio_local_path TEXT,
    audio_metadata TEXT,
    app_version TEXT NOT NULL DEFAULT '0.0.0',
    mic_device TEXT,
    mic_device_info TEXT,
    client_metadata TEXT,
    mode_meta TEXT,
    debug_info TEXT,
    audio_context TEXT,
    raw_text TEXT,
    edited_text TEXT,
    focused_app TEXT,
    focused_domain TEXT,
    error_code TEXT,
    error_message TEXT
  );
  CREATE INDEX idx_history_v2_user_created ON history_v2 (user_id, created_at);
  CREATE INDEX idx_history_v2_status ON history_v2 (status);
  CREATE INDEX idx_history_v2_user_status_created ON history_v2 (user_id, status, created_at);
  CREATE VIRTUAL TABLE history_fts USING fts5(refined_text, raw_text, user_prompt, tokenize = 'unicode61 remove_diacritics 2');
  `,
  // 2. estatísticas (D75): só números e o nome do app, sem texto; não some com o histórico
  `
  CREATE TABLE stats_events (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    local_day TEXT NOT NULL,
    local_hour INTEGER NOT NULL,
    mode TEXT NOT NULL,
    app TEXT,
    words INTEGER NOT NULL,
    audio_seconds REAL NOT NULL,
    delivery TEXT,
    web_search INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_stats_events_day ON stats_events (local_day);
  `,
]

/** Passos em código depois de uma migração (índice da migração → passo). */
const AFTER_MIGRATION: Record<number, (h: HistoryDb) => void> = {
  // As estatísticas começam com os ditados que já estão no histórico.
  1: (h) => h.backfillStats(),
}

const COLUMNS = [
  'id',
  'user_id',
  'status',
  'mode',
  'refined_text',
  'duration',
  'created_at',
  'updated_at',
  'audio_local_path',
  'audio_metadata',
  'app_version',
  'mic_device',
  'client_metadata',
  'mode_meta',
  'debug_info',
  'audio_context',
  'raw_text',
  'edited_text',
  'focused_app',
  'focused_domain',
  'error_code',
  'error_message',
] as const satisfies readonly (keyof HistoryRow)[]

export const DEFAULT_PAGE_SIZE = 50

export class HistoryDb {
  constructor(private readonly db: DatabaseSync) {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  /** Versão do esquema = quantas migrações já rodaram (`PRAGMA user_version`). */
  version(): number {
    return (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  }

  private migrate(): void {
    for (let v = this.version(); v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN')
      try {
        this.db.exec(MIGRATIONS[v])
        AFTER_MIGRATION[v]?.(this)
        this.db.exec(`PRAGMA user_version = ${v + 1}`)
        this.db.exec('COMMIT')
      } catch (err) {
        this.db.exec('ROLLBACK')
        throw err
      }
    }
  }

  get(id: string): HistoryRow | null {
    return (this.db.prepare('SELECT * FROM history_v2 WHERE id = ?').get(id) as unknown as HistoryRow) ?? null
  }

  /** Grava ou substitui a linha (refazer usa o mesmo id) e atualiza a busca. */
  upsert(row: HistoryRow): void {
    const cols = COLUMNS.join(', ')
    const marks = COLUMNS.map(() => '?').join(', ')
    const updates = COLUMNS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(`INSERT INTO history_v2 (${cols}) VALUES (${marks}) ON CONFLICT(id) DO UPDATE SET ${updates}`)
        .run(...COLUMNS.map((c) => row[c] ?? null))
      this.reindex(row.id)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  /** Texto editado pela pessoa depois de colar (aprendizado por edição). */
  setEditedText(id: string, text: string): void {
    this.db.prepare('UPDATE history_v2 SET edited_text = ?, updated_at = ? WHERE id = ?').run(text, new Date().toISOString(), id)
  }

  private reindex(id: string): void {
    const r = this.db
      .prepare(
        `SELECT rowid AS rid, refined_text, raw_text, json_extract(mode_meta, '$.ai_result.user_prompt') AS user_prompt
         FROM history_v2 WHERE id = ?`,
      )
      .get(id) as { rid: number; refined_text: string | null; raw_text: string | null; user_prompt: string | null } | undefined
    if (!r) return
    this.db.prepare('DELETE FROM history_fts WHERE rowid = ?').run(r.rid)
    this.db
      .prepare('INSERT INTO history_fts (rowid, refined_text, raw_text, user_prompt) VALUES (?, ?, ?, ?)')
      .run(r.rid, r.refined_text ?? '', r.raw_text ?? '', r.user_prompt ?? '')
  }

  list(query: HistoryQuery = {}): { rows: HistoryRow[]; next: string | null } {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 200)
    const where: string[] = []
    const args: (string | number)[] = []
    const match = query.text ? ftsQuery(query.text) : null
    if (match) {
      where.push('h.rowid IN (SELECT rowid FROM history_fts WHERE history_fts MATCH ?)')
      args.push(match)
    }
    if (query.mode) {
      where.push('h.mode = ?')
      args.push(query.mode)
    }
    if (query.before) {
      where.push('h.created_at < ?')
      args.push(query.before)
    }
    const sql = `SELECT h.* FROM history_v2 h ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY h.created_at DESC LIMIT ?`
    const rows = this.db.prepare(sql).all(...args, limit + 1) as unknown as HistoryRow[]
    const more = rows.length > limit
    const page = more ? rows.slice(0, limit) : rows
    return { rows: page, next: more ? page[page.length - 1].created_at : null }
  }

  count(): number {
    return (this.db.prepare('SELECT count(*) AS n FROM history_v2').get() as { n: number }).n
  }

  /** Apaga e devolve as linhas apagadas (para apagar os áudios também). */
  delete(ids: readonly string[]): HistoryRow[] {
    const removed: HistoryRow[] = []
    this.db.exec('BEGIN')
    try {
      for (const id of ids) {
        const row = this.db.prepare('SELECT rowid AS rid, * FROM history_v2 WHERE id = ?').get(id) as
          | (HistoryRow & { rid: number })
          | undefined
        if (!row) continue
        this.db.prepare('DELETE FROM history_fts WHERE rowid = ?').run(row.rid)
        this.db.prepare('DELETE FROM history_v2 WHERE id = ?').run(id)
        const { rid: _rid, ...rest } = row
        removed.push(rest)
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return removed
  }

  deleteAll(): HistoryRow[] {
    const ids = (this.db.prepare('SELECT id FROM history_v2').all() as { id: string }[]).map((r) => r.id)
    return this.delete(ids)
  }

  /** Tempo de guarda (`historyDurationSeconds`): apaga o que é mais velho que o corte. */
  deleteOlderThan(cutoffIso: string): HistoryRow[] {
    const ids = (this.db.prepare('SELECT id FROM history_v2 WHERE created_at < ?').all(cutoffIso) as { id: string }[]).map(
      (r) => r.id,
    )
    return this.delete(ids)
  }

  /** Textos finais recentes de ditado (amostras para o estilo pessoal). */
  recentDictationTexts(limit: number): string[] {
    return (
      this.db
        .prepare(
          `SELECT coalesce(edited_text, refined_text) AS t FROM history_v2
           WHERE status = 'completed' AND mode = 'voice_transcript' AND coalesce(edited_text, refined_text) <> ''
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(limit) as { t: string }[]
    ).map((r) => r.t)
  }

  // ---------- estatísticas (D75) ----------

  /** Grava ou atualiza o evento do ditado (refazer usa o mesmo id e não soma de novo). */
  recordStat(e: StatsEvent): void {
    this.db
      .prepare(
        `INSERT INTO stats_events (id, created_at, local_day, local_hour, mode, app, words, audio_seconds, delivery, web_search)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET words = excluded.words, audio_seconds = excluded.audio_seconds,
           delivery = excluded.delivery, web_search = excluded.web_search`,
      )
      .run(e.id, e.created_at, e.local_day, e.local_hour, e.mode, e.app, e.words, e.audio_seconds, e.delivery, e.web_search)
  }

  statEvents(): StatsEvent[] {
    return this.db.prepare('SELECT * FROM stats_events ORDER BY created_at').all() as unknown as StatsEvent[]
  }

  resetStats(): void {
    this.db.exec('DELETE FROM stats_events')
  }

  /** Cria os eventos dos ditados concluídos que já estão no histórico. */
  backfillStats(): void {
    const rows = this.db.prepare(`SELECT * FROM history_v2 WHERE status = 'completed'`).all() as unknown as HistoryRow[]
    for (const row of rows) {
      const e = statsEventFrom(row)
      if (e) this.recordStat(e)
    }
  }

  close(): void {
    this.db.close()
  }
}

/** Corte do tempo de guarda; null = guardar para sempre. */
export function retentionCutoff(seconds: number, now: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(now - seconds * 1000).toISOString()
}
