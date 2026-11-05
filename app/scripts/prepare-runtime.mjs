// Prepara o "Just Say.exe" (D74): uma cópia do Electron fora do OneDrive, com o nome e o
// ícone do Just Say, para o Gerenciador de Tarefas mostrar "Just Say" em vez de "Electron".
// Refaz a cópia só quando a versão do Electron ou o ícone mudam. Uso: node scripts/prepare-runtime.mjs
// Sai com 0 e imprime o caminho do executável; com 1 se não deu (o atalho cai no electron.exe).
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(app, 'node_modules', 'electron', 'dist')
const icon = join(app, 'resources', 'icon.ico')
// Fora do OneDrive (não sobe 367 MB para a nuvem) e fora do %LOCALAPPDATA%, cuja permissão de
// "contêiner de app" faz o Electron 44 se recusar a abrir.
const runtime = join(homedir(), '.just-say', 'runtime')
const exe = join(runtime, 'Just Say.exe')
const marker = join(runtime, 'just-say-runtime.json')

const electronVersion = JSON.parse(readFileSync(join(app, 'node_modules', 'electron', 'package.json'), 'utf8')).version
const iconHash = createHash('sha256').update(readFileSync(icon)).digest('hex').slice(0, 16)
const wanted = { electronVersion, iconHash, layout: 1 }

function current() {
  try {
    return JSON.parse(readFileSync(marker, 'utf8'))
  } catch {
    return null
  }
}

const have = current()
if (existsSync(exe) && have && JSON.stringify(have) === JSON.stringify(wanted)) {
  console.log(exe)
  process.exit(0)
}

try {
  if (existsSync(runtime)) rmSync(runtime, { recursive: true, force: true })
  mkdirSync(runtime, { recursive: true })
  cpSync(dist, runtime, { recursive: true })
  renameSync(join(runtime, 'electron.exe'), exe)

  const { rcedit } = await import('rcedit')
  await rcedit(exe, {
    icon,
    'version-string': {
      FileDescription: 'Just Say',
      ProductName: 'Just Say',
      CompanyName: 'Just Say',
      InternalName: 'Just Say',
      OriginalFilename: 'Just Say.exe',
    },
  })
  writeFileSync(marker, JSON.stringify(wanted, null, 2))
  console.log(exe)
} catch (err) {
  console.error(`[runtime] não consegui preparar o Just Say.exe: ${err?.message ?? err}`)
  process.exit(1)
}
