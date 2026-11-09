// Atualização pelo botão (D99), para quem instalou pelo ZIP do GitHub.
//
// 1. Confere o Release mais novo no GitHub (ao abrir e a cada 6 h; ou pelo botão).
// 2. "Atualizar agora": baixa só o código da versão nova (~1 MB) e extrai numa pasta ao lado
//    da instalação. Se as bibliotecas (package-lock) mudaram, instala as novas lá, com o app
//    ainda aberto; se não mudaram, as atuais são reaproveitadas.
// 3. Escreve um script de troca, abre ele e fecha o app. O script espera o app fechar, leva
//    para a pasta nova as bibliotecas, o Node portátil e os dados do servidor (server/data,
//    server/.env), monta o app, troca as pastas de lugar e reabre. Se algo falha antes da troca,
//    devolve tudo e reabre a versão antiga. A versão anterior fica em "<pasta>.anterior".
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { app } from 'electron'
import { compareVersions, lockDepsChanged, releaseFromFeed, type ReleaseInfo, type UpdateState } from '../shared/update'
import { runningFromProject } from './paths'

const FEED_URL = process.env.JUST_SAY_UPDATE_FEED || 'https://api.github.com/repos/juliobpsouza-sudo/just-say/releases/latest'
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_MS = 20_000

let state: UpdateState = {
  status: 'idle',
  current: app.getVersion(),
  latest: null,
  notesUrl: null,
  notes: null,
  step: null,
  error: null,
  checkedAt: null,
}
let release: ReleaseInfo | null = null
let listener: (s: UpdateState) => void = () => {}
let log: (line: string) => void = () => {}

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  listener(state)
}

export function updateState(): UpdateState {
  return state
}

/** Pasta da instalação (a que tem `app/`, `server/` e o `Instalar.cmd`). */
function installRoot(): string {
  return dirname(app.getAppPath())
}

/** Só a instalação pelo ZIP se atualiza: nunca a pasta de desenvolvimento nem um clone com git. */
export function updatesSupported(): boolean {
  if (!runningFromProject() || process.env.ELECTRON_RENDERER_URL) return false
  const root = installRoot()
  return existsSync(join(root, 'Instalar.cmd')) && !existsSync(join(root, '.git'))
}

const markerFile = () => join(app.getPath('userData'), 'atualizacao.json')
const logFile = () => join(app.getPath('userData'), 'Logs', 'atualizacao.log')

/** Só para teste (JUST_SAY_UPDATE_AUTO=1): como fechar o app ao atualizar sozinho. */
let autoQuit: (() => void) | null = null

export function initUpdater(onChange: (s: UpdateState) => void, logLine: (line: string) => void, quit?: () => void): void {
  listener = onChange
  log = logLine
  autoQuit = quit ?? null
  if (!updatesSupported()) {
    set({ status: 'unsupported' })
    return
  }
  // Voltou de uma atualização? Diz se deu certo.
  if (existsSync(markerFile())) {
    try {
      const m = JSON.parse(readFileSync(markerFile(), 'utf8')) as { from: string; to: string }
      if (compareVersions(state.current, m.to) >= 0) set({ status: 'updated', latest: state.current })
      else set({ status: 'error', error: `A atualização para a ${m.to} não deu certo; você continua na ${state.current}. Detalhes em ${logFile()}.` })
      log(`[atualização] ${m.from} → ${m.to}: ${state.status === 'updated' ? 'ok' : 'falhou'}`)
    } catch {
      // marcador ilegível: ignora
    }
    rmSync(markerFile(), { force: true })
  }
  setTimeout(() => void checkForUpdate(false), FIRST_CHECK_MS)
  setInterval(() => void checkForUpdate(false), CHECK_EVERY_MS)
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': 'just-say-updater', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** `manual`: veio do botão; aí o erro aparece na tela. Na conferência automática, falha em silêncio. */
export async function checkForUpdate(manual: boolean): Promise<UpdateState> {
  if (state.status === 'unsupported' || state.status === 'preparing' || state.status === 'restarting') return state
  const before = state.status
  if (manual) set({ status: 'checking', error: null })
  try {
    const info = releaseFromFeed(await fetchJson(FEED_URL))
    if (!info) throw new Error('resposta inesperada do GitHub')
    release = info
    const newer = compareVersions(info.version, state.current) > 0
    const auto = newer && process.env.JUST_SAY_UPDATE_AUTO === '1'
    set({
      status: newer ? 'available' : before === 'updated' ? 'updated' : 'uptodate',
      latest: info.version,
      notesUrl: info.notesUrl,
      notes: info.notes,
      checkedAt: Date.now(),
      error: null,
    })
    if (auto && autoQuit) void applyUpdate(autoQuit)
  } catch (err) {
    log(`[atualização] conferência falhou: ${(err as Error).message}`)
    if (manual) set({ status: 'error', error: 'Não consegui falar com o GitHub. Confira a internet e tente de novo.' })
    else if (before === 'checking') set({ status: 'idle' })
  }
  return state
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const keep = (d: Buffer) => {
      tail = (tail + d.toString()).slice(-4000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${basename(cmd)} ${args.join(' ')} saiu com ${code}\n${tail}`))))
  })
}

/** Mesmas bibliotecas nos dois package-lock (fora o número da versão do app). */
function sameDeps(a: string, b: string): boolean {
  if (!existsSync(a) || !existsSync(b)) return false
  return !lockDepsChanged(readFileSync(a, 'utf8'), readFileSync(b, 'utf8'))
}

/** Ambiente com o Node portátil (se a instalação usa um) na frente do PATH. */
function nodeEnv(root: string): NodeJS.ProcessEnv {
  const portable = join(root, 'runtime', 'node')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  if (existsSync(join(portable, 'node.exe'))) env.PATH = `${portable};${env.PATH ?? ''}`
  return env
}

/** O roteiro de troca (roda depois que o app fecha). Só ASCII: os caminhos chegam por variável de ambiente. */
const SWAP_SCRIPT = String.raw`@echo off
setlocal EnableExtensions
cd /d "%JS_STAGE%\.."
call :log "troca: inicio %JS_FROM% para %JS_TO%"
rem 1. Espera o Just Say (e o que roda da pasta dele) fechar; depois de 60 s, encerra.
powershell -NoProfile -NonInteractive -Command "$r=$env:JS_ROOT.TrimEnd('\')+'\'; $n=0; while((Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($r,[StringComparison]::OrdinalIgnoreCase) }) -and $n -lt 120){ Start-Sleep -Milliseconds 500; $n++ }; Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($r,[StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue"
ping -n 2 127.0.0.1 >nul
set MOVED_APP=0
set MOVED_SRV=0
set MOVED_RT=0
set MOVED_DATA=0
rem 2. Leva para a pasta nova o que nao vem no ZIP.
if not "%JS_REUSE_APP%"=="1" goto skip_app
if not exist "%JS_ROOT%\app\node_modules" goto skip_app
move "%JS_ROOT%\app\node_modules" "%JS_NEW%\app\node_modules" >nul || goto falhou
set MOVED_APP=1
:skip_app
if not "%JS_REUSE_SRV%"=="1" goto skip_srv
if not exist "%JS_ROOT%\server\node_modules" goto skip_srv
move "%JS_ROOT%\server\node_modules" "%JS_NEW%\server\node_modules" >nul || goto falhou
set MOVED_SRV=1
:skip_srv
if not exist "%JS_ROOT%\runtime" goto skip_rt
if exist "%JS_NEW%\runtime" goto skip_rt
move "%JS_ROOT%\runtime" "%JS_NEW%\runtime" >nul || goto falhou
set MOVED_RT=1
:skip_rt
if not exist "%JS_ROOT%\server\data" goto skip_data
if exist "%JS_NEW%\server\data" rd /s /q "%JS_NEW%\server\data"
move "%JS_ROOT%\server\data" "%JS_NEW%\server\data" >nul || goto falhou
set MOVED_DATA=1
:skip_data
if exist "%JS_ROOT%\server\.env" copy /y "%JS_ROOT%\server\.env" "%JS_NEW%\server\.env" >nul
call :log "troca: dependencias e dados levados"
rem 3. Monta o app novo.
set "PATH=%JS_NEW%\runtime\node;%PATH%"
pushd "%JS_NEW%\app"
call npm run build >> "%JS_LOG%" 2>&1
if errorlevel 1 (
  popd
  goto falhou
)
popd
call :log "troca: app montado"
rem 4. Troca as pastas de lugar (tenta por ate 20 s, caso algo ainda segure a pasta).
if exist "%JS_OLD%" rd /s /q "%JS_OLD%"
set N=0
:tenta
move "%JS_ROOT%" "%JS_OLD%" >nul 2>&1 && goto trocou
set /a N+=1
if %N% GEQ 20 goto falhou
ping -n 2 127.0.0.1 >nul
goto tenta
:trocou
move "%JS_NEW%" "%JS_ROOT%" >nul 2>&1 && goto pronto
call :log "troca: nao consegui por a pasta nova no lugar; voltando"
move "%JS_OLD%" "%JS_ROOT%" >nul 2>&1
goto falhou
:pronto
call :log "troca: ok"
rd /s /q "%JS_STAGE%" >nul 2>&1
call "%JS_ROOT%\Abrir Just Say.cmd"
exit /b 0
:falhou
call :log "troca: FALHOU, voltando para a versao anterior"
if "%MOVED_APP%"=="1" move "%JS_NEW%\app\node_modules" "%JS_ROOT%\app\node_modules" >nul
if "%MOVED_SRV%"=="1" move "%JS_NEW%\server\node_modules" "%JS_ROOT%\server\node_modules" >nul
if "%MOVED_RT%"=="1" move "%JS_NEW%\runtime" "%JS_ROOT%\runtime" >nul
if "%MOVED_DATA%"=="1" move "%JS_NEW%\server\data" "%JS_ROOT%\server\data" >nul
rd /s /q "%JS_STAGE%" >nul 2>&1
call "%JS_ROOT%\Abrir Just Say.cmd"
exit /b 1
:log
echo %date% %time% %~1>> "%JS_LOG%"
exit /b 0
`

/** "Atualizar agora". Prepara tudo com o app aberto e, no fim, fecha o app para a troca. */
export async function applyUpdate(quit: () => void): Promise<UpdateState> {
  if (state.status !== 'available' || !release) return state
  const info = release
  const root = installRoot()
  const stage = `${root}.atualizando`
  try {
    set({ status: 'preparing', step: 'Baixando a versão nova…', error: null })
    rmSync(stage, { recursive: true, force: true })
    mkdirSync(stage, { recursive: true })
    const res = await fetch(info.zipUrl, { headers: { 'User-Agent': 'just-say-updater' }, signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`download: HTTP ${res.status}`)
    const zip = join(stage, 'versao.zip')
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()))
    log(`[atualização] baixado ${info.tag} (${statSync(zip).size} bytes)`)

    set({ step: 'Abrindo o pacote…' })
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    await run(tar, ['-xf', zip, '-C', stage], stage, process.env)
    rmSync(zip, { force: true })
    const dirs = readdirSync(stage).filter((d) => statSync(join(stage, d)).isDirectory())
    if (dirs.length !== 1) throw new Error(`pacote inesperado: ${dirs.length} pastas`)
    const next = join(stage, dirs[0])
    const pkg = JSON.parse(readFileSync(join(next, 'app', 'package.json'), 'utf8')) as { version?: string }
    if (!existsSync(join(next, 'Instalar.cmd')) || pkg.version !== info.version)
      throw new Error(`pacote não é a versão ${info.version} (veio ${pkg.version ?? '?'})`)

    // Bibliotecas: reaproveita se o package-lock é o mesmo; senão, instala as novas agora.
    const reuseApp = sameDeps(join(root, 'app', 'package-lock.json'), join(next, 'app', 'package-lock.json'))
    const reuseSrv = sameDeps(join(root, 'server', 'package-lock.json'), join(next, 'server', 'package-lock.json'))
    const env = nodeEnv(root)
    const cmd = process.env.ComSpec ?? 'cmd.exe'
    if (!reuseSrv) {
      set({ step: 'Instalando as bibliotecas novas do servidor…' })
      await run(cmd, ['/d', '/c', 'npm', 'ci', '--no-audit', '--no-fund'], join(next, 'server'), env)
    }
    if (!reuseApp) {
      set({ step: 'Instalando as bibliotecas novas do app (pode levar alguns minutos)…' })
      await run(cmd, ['/d', '/c', 'npm', 'ci', '--no-audit', '--no-fund'], join(next, 'app'), env)
      await run(cmd, ['/d', '/c', 'node', join('node_modules', 'electron', 'install.js')], join(next, 'app'), env)
    }
    log(`[atualização] bibliotecas: app ${reuseApp ? 'reaproveitadas' : 'novas'}, servidor ${reuseSrv ? 'reaproveitadas' : 'novas'}`)

    // Roteiro de troca, fora das duas pastas (o cmd não pode segurar nenhuma delas).
    const script = join(app.getPath('temp'), 'just-say-trocar-versao.cmd')
    writeFileSync(script, SWAP_SCRIPT.replace(/\r?\n/g, '\r\n'))
    mkdirSync(dirname(logFile()), { recursive: true })
    writeFileSync(markerFile(), JSON.stringify({ from: state.current, to: info.version, at: new Date().toISOString() }))
    set({ status: 'restarting', step: 'Fechando para atualizar. O Just Say abre de novo sozinho.' })
    // /s + aspas duplas: o jeito seguro de o cmd aceitar um caminho com espaço.
    const child = spawn(cmd, ['/d', '/s', '/c', `""${script}""`], {
      cwd: dirname(root),
      detached: true,
      windowsVerbatimArguments: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...env,
        JS_ROOT: root,
        JS_NEW: next,
        JS_STAGE: stage,
        JS_OLD: `${root}.anterior`,
        JS_REUSE_APP: reuseApp ? '1' : '0',
        JS_REUSE_SRV: reuseSrv ? '1' : '0',
        JS_LOG: logFile(),
        JS_FROM: state.current,
        JS_TO: info.version,
      },
    })
    child.unref()
    setTimeout(quit, 800)
  } catch (err) {
    const msg = (err as Error).message
    log(`[atualização] preparo falhou: ${msg}`)
    try {
      writeFileSync(logFile(), `${new Date().toISOString()} preparo falhou: ${msg}\n`, { flag: 'a' })
    } catch {
      // sem log
    }
    rmSync(stage, { recursive: true, force: true })
    set({ status: 'error', step: null, error: 'Não deu para preparar a atualização. Nada mudou: você continua na versão atual.' })
  }
  return state
}
