// IA local na placa de vídeo (D94): o Whisper local (transcrição) e o llama.cpp com um Qwen3.5
// (limpeza do ditado). São a reserva do Groq: sobem só quando um pedido chega neles (o Groq
// falhou ou está sem internet), ficam prontos por IDLE_MS depois do último uso e desligam,
// devolvendo a memória da placa. Com internet, nada local fica carregado.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { config, ROOT } from './config.ts'
import { ProviderUnavailableError } from './providers/types.ts'

export type LocalKind = 'whisper' | 'llm'

const IDLE_MS = 15 * 60_000
/** Memória livre na placa para usar o modelo 9B (mais fiel); abaixo disso, o 4B (D94). */
const MIN_FREE_MIB_FOR_9B = 7000

/** Onde ficam o ambiente Python, o llama.cpp e os modelos (~10 GB): fora de pastas sincronizadas. */
export function localDir(): string {
  if (process.env.JUST_SAY_LOCAL_DIR) return process.env.JUST_SAY_LOCAL_DIR
  return join(homedir(), '.just-say', 'local')
}

const paths = () => {
  const dir = localDir()
  return {
    python: join(dir, 'whisper-venv', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python'),
    whisperScript: join(ROOT, 'local-whisper', 'server.py'),
    hfHome: join(dir, 'hf'),
    llamaServer: join(dir, 'llama', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'),
    model9b: join(dir, 'models', 'Qwen3.5-9B-Q4_K_M.gguf'),
    model4b: join(dir, 'models', 'Qwen3.5-4B-Q4_K_M.gguf'),
  }
}

/** Está instalado no PC? */
export function localInstalled(kind: LocalKind): boolean {
  const p = paths()
  return kind === 'whisper' ? existsSync(p.python) : existsSync(p.llamaServer) && (existsSync(p.model4b) || existsSync(p.model9b))
}

interface State {
  child: ChildProcess | null
  starting: Promise<void> | null
  idleTimer: NodeJS.Timeout | null
  model: string | null
}

const state: Record<LocalKind, State> = {
  whisper: { child: null, starting: null, idleTimer: null, model: null },
  llm: { child: null, starting: null, idleTimer: null, model: null },
}

const baseUrl = (kind: LocalKind) => (kind === 'whisper' ? config.localWhisperUrl : config.localLlmUrl)

async function healthy(kind: LocalKind): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl(kind)}/health`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return false // o llama.cpp responde 503 enquanto carrega o modelo
    const body = (await res.json()) as { ok?: boolean; status?: string }
    return body.ok === true || body.status === 'ok'
  } catch {
    return false
  }
}

/** Memória livre na placa NVIDIA, em MiB (null se não der para medir). */
function freeVramMiB(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], { timeout: 3000, windowsHide: true }, (err, out) => {
      const n = Number(String(out).trim().split(/\r?\n/)[0])
      resolve(err || !Number.isFinite(n) ? null : n)
    })
  })
}

function port(kind: LocalKind): string {
  return new URL(baseUrl(kind)).port || (kind === 'whisper' ? '8788' : '8790')
}

async function launch(kind: LocalKind): Promise<ChildProcess> {
  const p = paths()
  if (kind === 'whisper') {
    return spawn(p.python, [p.whisperScript], {
      cwd: ROOT,
      env: { ...process.env, HF_HOME: p.hfHome, LOCAL_WHISPER_PORT: port(kind), HF_HUB_DISABLE_SYMLINKS_WARNING: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  }
  const free = existsSync(p.model9b) ? await freeVramMiB() : null
  const model = free !== null && free >= MIN_FREE_MIB_FOR_9B ? p.model9b : existsSync(p.model4b) ? p.model4b : p.model9b
  state.llm.model = model.includes('9B') ? 'Qwen3.5-9B' : 'Qwen3.5-4B'
  console.log(`[ia local] limpeza com ${state.llm.model} (placa com ${free ?? '?'} MiB livres)`)
  // Contexto de 4096 tokens e cache KV em 8 bits. `--fit` põe na placa só as camadas que cabem
  // (com 512 MiB de folga) e o resto no processador: sem isso o Windows jogava o excesso da
  // placa para a RAM, e o modelo levava mais de 16 s para carregar. `ngram-simple` adivinha
  // pedaços copiando da transcrição: o texto sai igual e a escrita fica 60% mais rápida (D94).
  return spawn(
    p.llamaServer,
    ['-m', model, '--host', '127.0.0.1', '--port', port(kind), '--fit', 'on', '--fit-target', '512', '--spec-type', 'ngram-simple', '-c', '4096', '-fa', 'on', '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0', '--no-webui', '-np', '1'],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  )
}

function stop(kind: LocalKind): void {
  const s = state[kind]
  if (s.idleTimer) clearTimeout(s.idleTimer)
  s.idleTimer = null
  const pid = s.child?.pid
  s.child = null
  s.model = null
  if (!pid) return
  console.log(`[ia local] ${kind} desligado (parado há ${IDLE_MS / 60_000} min)`)
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  else process.kill(pid)
}

/** Local que é a 1ª opção ligada na tela Modelos: fica sempre pronto, sem desligar por inatividade. */
const pinned: Record<LocalKind, boolean> = { whisper: false, llm: false }

function touch(kind: LocalKind): void {
  const s = state[kind]
  if (s.idleTimer) clearTimeout(s.idleTimer)
  s.idleTimer = null
  // Só desliga o que este servidor ligou (um Whisper aberto à mão fica) e o que não é o principal.
  if (s.child && !pinned[kind]) s.idleTimer = setTimeout(() => stop(kind), IDLE_MS)
}

/**
 * A placa virou a 1ª opção (o Groq foi desligado na tela Modelos): liga já, um de cada vez
 * (o `--fit` mede o que sobrou), e mantém ligado. Sem isso, o 1º ditado esperava o Whisper
 * carregar a frio (~14 s) e estourava o prazo da transcrição (D94).
 */
export function setLocalPrimary(primary: Record<LocalKind, boolean>): void {
  const toWarm: LocalKind[] = []
  for (const kind of ['whisper', 'llm'] as const) {
    if (primary[kind] && !pinned[kind] && localInstalled(kind)) toWarm.push(kind)
    pinned[kind] = primary[kind]
    touch(kind) // liga ou desliga o desligamento por inatividade
  }
  if (!toWarm.length || process.env.VITEST) return // nos testes, nada liga de verdade
  void (async () => {
    for (const kind of toWarm) await ensureLocal(kind).catch((err) => console.error(`[ia local] não consegui ligar ${kind}`, err))
  })()
}

/**
 * Garante o serviço local no ar, ligando se preciso. Espera até `signal` abortar (o prazo do
 * pedido). Erro de "não instalado" ou "não subiu" vira ProviderUnavailableError (a cascata
 * passa para o próximo degrau).
 */
export async function ensureLocal(kind: LocalKind, signal?: AbortSignal): Promise<void> {
  const s = state[kind]
  if (!s.starting && (await healthy(kind))) {
    touch(kind)
    return
  }
  if (!localInstalled(kind)) throw new ProviderUnavailableError(`${kind === 'whisper' ? 'Whisper' : 'Modelo'} local não instalado em ${localDir()}`)
  s.starting ??= (async () => {
    if (!s.child) {
      const child = await launch(kind)
      s.child = child
      child.stderr?.on('data', (d) => {
        const line = String(d)
        if (/error|exception|failed|out of memory/i.test(line)) console.error(`[ia local:${kind}] ${line.trim().slice(0, 300)}`)
      })
      child.stdout?.on('data', () => {})
      child.on('exit', (code) => {
        if (s.child === child) {
          s.child = null
          console.log(`[ia local] ${kind} saiu (code=${code})`)
        }
      })
    }
    // O primeiro carregamento lê o modelo do disco: até 90 s.
    for (let i = 0; i < 360; i++) {
      if (await healthy(kind)) return
      if (!s.child) throw new ProviderUnavailableError(`${kind} local não subiu`)
      await sleep(250)
    }
    throw new ProviderUnavailableError(`${kind} local não respondeu em 90 s`)
  })().finally(() => {
    s.starting = null
  })
  const started = s.starting
  if (signal) {
    await Promise.race([
      started,
      new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    ])
  } else await started
  touch(kind)
}

/** Começa a ligar em segundo plano (ex.: o Groq está sem internet; o próximo passo vai precisar). */
export function warmLocal(kind: LocalKind): void {
  if (!localInstalled(kind)) return
  void ensureLocal(kind).catch(() => {})
}

/** Testa se o Groq está alcançável: só abre e fecha uma conexão TCP (DNS + rede), sem mandar nada. */
function groqReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: 'api.groq.com', port: 443, timeout: 3000 })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * Vigia de internet (D94): a cada 30 s confere se o Groq está alcançável. Com 2 falhas seguidas,
 * liga o Whisper e depois o modelo de limpeza (nessa ordem: o `--fit` do llama.cpp mede a
 * memória que sobrou), para o primeiro ditado sem internet já sair limpo. Quando a internet
 * volta, não faz nada: os locais desligam sozinhos depois de IDLE_MS sem uso.
 */
export function startOfflineWatch(everyMs = 30_000): void {
  if (!localInstalled('whisper') && !localInstalled('llm')) return
  let misses = 0
  const tick = async () => {
    if (await groqReachable()) {
      misses = 0
      return
    }
    misses++
    if (misses !== 2) return
    console.log('[ia local] sem conexão com o Groq: ligando a reserva local')
    try {
      if (localInstalled('whisper')) await ensureLocal('whisper')
      if (localInstalled('llm')) await ensureLocal('llm')
    } catch (err) {
      console.error('[ia local] não consegui ligar a reserva', err)
    }
  }
  setInterval(() => void tick(), everyMs).unref()
}

/** Qual modelo de limpeza está carregado (para o log). */
export function localLlmModel(): string | null {
  return state.llm.model
}

/** Desliga o que este servidor ligou (servidor saindo). */
export function stopAllLocal(): void {
  stop('whisper')
  stop('llm')
}
