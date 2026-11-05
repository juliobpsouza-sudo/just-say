// Dicionário pessoal e estilo pessoal: tipos que o servidor devolve (server/src/db.ts e style.ts).

export interface DictionaryEntry {
  id: string
  term: string
  /** `auto`: entrou pelo aprendizado por edição; `manual`: a pessoa pôs. */
  source: 'manual' | 'auto'
  created_at: string
  updated_at: string
}

export interface StyleState {
  enabled: boolean
  profile: string | null
  updatedAt: string | null
  pending: number
  samplesUsed: number
}

/**
 * CSV do dicionário → termos. Pega a primeira coluna de cada linha (separada por vírgula,
 * ponto e vírgula ou tabulação), tira aspas e o cabeçalho "termo"/"term", sem repetir.
 */
export function parseDictionaryCsv(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    let cell = raw.trim()
    if (!cell) continue
    if (cell.startsWith('"')) {
      const end = cell.indexOf('"', 1)
      cell = end > 0 ? cell.slice(1, end) : cell.slice(1)
    } else {
      cell = cell.split(/[,;\t]/)[0]
    }
    const term = cell.trim().replace(/\s+/g, ' ')
    if (!term || term.length > 100 || /^(termo|term|palavra|word)s?$/i.test(term)) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(term)
  }
  return out
}
