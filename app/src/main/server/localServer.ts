// Em desenvolvimento, o app sobe o servidor local sozinho (Just_Say/server) se ele não
// estiver rodando. Assim basta `npm run dev` no app. Ver DECISOES D36.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { app } from 'electron'
import { runningFromProject } from '../paths'
import { serverHealth } from './client'

let child: ChildProcess | null = null

function serverDir(): string {
  return join(app.getAppPath(), '..', 'server')
}

/** O Node portátil que o Instalar.cmd baixa (runtime/node) quando o PC não tem um; senão, o do sistema. */
function nodeBin(): string {
  const portable = join(app.getAppPath(), '..', 'runtime', 'node', 'node.exe')
  return existsSync(portable) ? portable : 'node'
}

export async function ensureLocalServer(log: (line: string) => void): Promise<boolean> {
  if ((await serverHealth()).ok) return true
  const dir = serverDir()
  const tsxCli = join(dir, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  if (!runningFromProject() || !existsSync(tsxCli)) {
    log('[servidor] fora do ar e não sei iniciar daqui (rode `npm run dev` em Just_Say/server)')
    return false
  }
  log('[servidor] iniciando Just_Say/server...')
  child = spawn(nodeBin(), [tsxCli, 'src/index.ts'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout?.on('data', (d) => String(d).trim().split('\n').forEach((l) => log(l)))
  child.stderr?.on('data', (d) => String(d).trim().split('\n').forEach((l) => log(`[servidor:erro] ${l}`)))
  child.on('exit', (code) => {
    log(`[servidor] saiu (code=${code})`)
    child = null
  })
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    if ((await serverHealth()).ok) return true
  }
  log('[servidor] não respondeu em 10 s')
  return false
}

/**
 * Para o servidor e os processos que ele abriu. O `tsx` sobe outro `node` por baixo, e é esse
 * neto que ouve a porta. No Windows, matar só o filho deixava o neto órfão, e a próxima
 * abertura reaproveitava o servidor antigo com o código velho (D89). `taskkill /T` derruba a
 * árvore inteira; é síncrono porque roda no fechamento do app.
 */
export function stopLocalServer(): void {
  const pid = child?.pid
  child = null
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } catch {
      // já tinha saído
    }
  } else {
    process.kill(pid)
  }
}
