// Janelas: barra flutuante (nunca rouba foco) e Hub.
import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { TIMING } from '../shared/constants'
import { IPC } from '../shared/ipc'
import { resourcePath } from './paths'

const preloadPath = join(import.meta.dirname, '../preload/index.cjs')

function loadPage(win: BrowserWindow, page: 'floating-bar' | 'hub' | 'copy-card' | 'answer-card', hash = ''): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(`${devUrl}/${page}.html${hash ? `#${hash}` : ''}`)
  else void win.loadFile(join(import.meta.dirname, `../renderer/${page}.html`), { hash })
}

// ---------- barra flutuante ----------

const BAR_WIDTH = 460
const BAR_HEIGHT = 110
const BAR_BOTTOM_MARGIN = 16

let bar: BrowserWindow | null = null
let followTimer: NodeJS.Timeout | null = null
let lastDisplayKey = ''

export function createFloatingBar(): BrowserWindow {
  bar = new BrowserWindow({
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // `type: 'panel'` só existe no macOS. No Windows, `focusable: false` vira
    // WS_EX_NOACTIVATE, e `toolbar` tira a janela do Alt+Tab.
    type: 'toolbar',
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      // A máquina de estados e os timers rodam aqui mesmo com a janela escondida.
      backgroundThrottling: false,
    },
  })
  bar.setAlwaysOnTop(true, 'screen-saver')
  bar.setVisibleOnAllWorkspaces(true)
  // Clique atravessa a barra, mas o movimento do mouse chega: assim o chip do idioma
  // pode pedir para receber o clique quando o mouse passa por cima.
  bar.setIgnoreMouseEvents(true, { forward: true })
  loadPage(bar, 'floating-bar')
  bar.on('closed', () => {
    bar = null
    stopFollowing()
  })
  return bar
}

export function floatingBar(): BrowserWindow | null {
  return bar
}

/** O chip do idioma pede o clique enquanto o mouse está sobre ele. A barra nunca pega foco. */
export function setFloatingBarInteractive(interactive: boolean): void {
  if (!bar) return
  if (interactive) bar.setIgnoreMouseEvents(false)
  else bar.setIgnoreMouseEvents(true, { forward: true })
}

function placeBarOnCursorDisplay(force = false): void {
  if (!bar) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea
  const key = `${display.id}:${wa.x},${wa.y},${wa.width},${wa.height}`
  if (!force && key === lastDisplayKey) return
  lastDisplayKey = key
  bar.setBounds({
    x: Math.round(wa.x + (wa.width - BAR_WIDTH) / 2),
    y: Math.round(wa.y + wa.height - BAR_HEIGHT - BAR_BOTTOM_MARGIN),
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
  })
}

function startFollowing(): void {
  if (followTimer) return
  followTimer = setInterval(() => placeBarOnCursorDisplay(), TIMING.FLOATING_BAR_FOLLOW_CURSOR_MS)
}

function stopFollowing(): void {
  if (followTimer) clearInterval(followTimer)
  followTimer = null
}

export function setFloatingBarVisible(visible: boolean): void {
  if (!bar) return
  if (visible) {
    placeBarOnCursorDisplay(true)
    if (!bar.isVisible()) bar.showInactive()
    bar.setAlwaysOnTop(true, 'screen-saver')
    startFollowing()
  } else {
    stopFollowing()
    setFloatingBarInteractive(false)
    if (bar.isVisible()) bar.hide()
  }
}

// ---------- cartão "clique para copiar" ----------
// Aparece quando o campo não parece editável: o texto é colado mesmo assim, e o cartão
// oferece copiar. Não rouba o foco (focusable: false), mas recebe o clique.

const CARD_WIDTH = 380
const CARD_HEIGHT = 150
const CARD_VISIBLE_MS = 10_000

let card: BrowserWindow | null = null
let cardText = ''
let cardTimer: NodeJS.Timeout | null = null

export function copyCardText(): string {
  return cardText
}

export function closeCopyCard(): void {
  if (cardTimer) clearTimeout(cardTimer)
  cardTimer = null
  if (card && !card.isDestroyed()) card.hide()
}

export function showCopyCard(text: string): void {
  cardText = text
  if (!card || card.isDestroyed()) {
    card = new BrowserWindow({
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      type: 'toolbar',
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true },
    })
    card.setAlwaysOnTop(true, 'screen-saver')
    loadPage(card, 'copy-card')
  } else {
    card.webContents.send(IPC.copyCardText, text)
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea
  card.setBounds({
    x: Math.round(wa.x + (wa.width - CARD_WIDTH) / 2),
    y: Math.round(wa.y + wa.height - BAR_HEIGHT - BAR_BOTTOM_MARGIN - CARD_HEIGHT),
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  })
  card.showInactive()
  if (cardTimer) clearTimeout(cardTimer)
  cardTimer = setTimeout(closeCopyCard, CARD_VISIBLE_MS)
}

// ---------- cartão de resposta do Just Ask ("reply") ----------
// Ao contrário do cartão de copiar, este recebe foco: a pessoa vai ler, rolar e selecionar.

export interface AnswerCardPayload {
  question: string
  answer: string
  sources: { title: string; url: string }[]
}

const ANSWER_WIDTH = 480
const ANSWER_HEIGHT = 440

let answerCard: BrowserWindow | null = null
let answerPayload: AnswerCardPayload | null = null

export function answerCardPayload(): AnswerCardPayload | null {
  return answerPayload
}

export function closeAnswerCard(): void {
  if (answerCard && !answerCard.isDestroyed()) answerCard.hide()
}

export function showAnswerCard(payload: AnswerCardPayload): void {
  answerPayload = payload
  if (!answerCard || answerCard.isDestroyed()) {
    answerCard = new BrowserWindow({
      width: ANSWER_WIDTH,
      height: ANSWER_HEIGHT,
      show: false,
      frame: false,
      // Janela transparente: os cantos arredondados e a sombra são desenhados pelo CSS.
      // No Windows 10, janela transparente não redimensiona direito, então o tamanho é fixo
      // e a resposta rola por dentro.
      transparent: true,
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'Just Say — resposta',
      icon: resourcePath('icon.ico'),
      backgroundColor: '#00000000',
      webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true },
    })
    answerCard.on('closed', () => (answerCard = null))
    // Fechar pelo X do sistema (Alt+F4) só esconde: a janela é reaproveitada.
    answerCard.on('close', (e) => {
      if (!quitting) {
        e.preventDefault()
        answerCard?.hide()
      }
    })
    answerCard.once('ready-to-show', () => answerCard?.show())
    loadPage(answerCard, 'answer-card')
  } else {
    answerCard.webContents.send(IPC.answerCardData, payload)
    answerCard.show()
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea
  const [w, h] = answerCard.getSize()
  answerCard.setBounds({
    x: Math.round(wa.x + (wa.width - w) / 2),
    y: Math.round(wa.y + wa.height - BAR_HEIGHT - BAR_BOTTOM_MARGIN - h),
    width: w,
    height: h,
  })
  answerCard.focus()
}

let quitting = false
export function markQuitting(): void {
  quitting = true
}

// ---------- Hub ----------

let hub: BrowserWindow | null = null

export function openHub(route = '/dashboard'): BrowserWindow {
  if (hub && !hub.isDestroyed()) {
    hub.webContents.send(IPC.hubNavigate, route)
    if (hub.isMinimized()) hub.restore()
    hub.show()
    hub.focus()
    return hub
  }
  hub = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    title: 'Just Say',
    icon: resourcePath('icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true },
  })
  hub.once('ready-to-show', () => hub?.show())
  hub.on('closed', () => (hub = null))
  loadPage(hub, 'hub', route)
  return hub
}

export function allWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
}

export function hubWindow(): BrowserWindow | null {
  return hub && !hub.isDestroyed() ? hub : null
}
