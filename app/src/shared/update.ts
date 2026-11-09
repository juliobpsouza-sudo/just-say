// Atualização pelo botão (D99): tipos e comparação de versões, sem Electron (testável).

export type UpdateStatus =
  | 'unsupported' // não é uma instalação pelo ZIP (pasta de desenvolvimento, clone com .git)
  | 'idle'
  | 'checking'
  | 'uptodate'
  | 'available'
  | 'preparing' // baixando o código e, se preciso, as bibliotecas novas
  | 'restarting' // o app vai fechar e reabrir na versão nova
  | 'updated' // abriu já na versão nova
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  current: string
  latest: string | null
  /** Página da versão no GitHub (notas). */
  notesUrl: string | null
  /** O que mudou, em markdown (corpo do Release). */
  notes: string | null
  /** Etapa em andamento, para a tela. */
  step: string | null
  error: string | null
  checkedAt: number | null
}

/** "v0.1.10" → [0, 1, 10]. Partes que não são número viram 0. */
export function parseVersion(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .slice(0, 3)
    .map((p) => (/^\d+$/.test(p) ? Number(p) : 0))
}

/** > 0 se `a` é mais nova que `b`, < 0 se mais velha, 0 se igual. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * As bibliotecas mudaram entre dois package-lock.json? Ignora o número da versão do próprio
 * Just Say (que muda em toda versão) e compara o resto. Arquivo ilegível conta como mudança.
 */
export function lockDepsChanged(a: string, b: string): boolean {
  try {
    const norm = (t: string) => {
      const j = JSON.parse(t) as { version?: string; packages?: Record<string, { version?: string }> }
      delete j.version
      if (j.packages?.['']) delete j.packages[''].version
      return JSON.stringify(j)
    }
    return norm(a) !== norm(b)
  } catch {
    return true
  }
}

export interface ReleaseInfo {
  version: string
  tag: string
  zipUrl: string
  notesUrl: string | null
  notes: string | null
}

/** Lê a resposta de `releases/latest` do GitHub (ou de um feed de teste no mesmo formato). */
export function releaseFromFeed(json: unknown): ReleaseInfo | null {
  if (!json || typeof json !== 'object') return null
  const r = json as Record<string, unknown>
  const tag = typeof r.tag_name === 'string' ? r.tag_name : null
  const zipUrl = typeof r.zip_url === 'string' ? r.zip_url : typeof r.zipball_url === 'string' ? r.zipball_url : null
  if (!tag || !zipUrl || !/^v?\d+\.\d+\.\d+/.test(tag)) return null
  if (r.draft === true || r.prerelease === true) return null
  return {
    version: tag.replace(/^v/i, ''),
    tag,
    zipUrl,
    notesUrl: typeof r.html_url === 'string' ? r.html_url : null,
    notes: typeof r.body === 'string' ? r.body.slice(0, 5000) : null,
  }
}
