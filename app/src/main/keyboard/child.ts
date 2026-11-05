// Processo Node filho que segura o hook de teclado.
// O hook fica isolado do event loop do main: se o main travar, o Windows não derruba o hook.
// Conversa com o main por IPC do `fork`.
import koffi from 'koffi'

type ParentMessage =
  | { type: 'updateTargetShortcuts'; shortcuts: string[][] }
  | { type: 'resetPressingKeycodes' }
  | { type: 'setWatcherInterval'; ms: number }
  | { type: 'getKeyboardDeviceList'; requestId: number }
  | { type: 'stop' }

function send(message: unknown) {
  process.send?.(message)
}

function main() {
  const libPath = process.env.JUST_SAY_KEYBOARD_LIB_PATH
  if (!libPath) throw new Error('JUST_SAY_KEYBOARD_LIB_PATH não definido')

  const lib = koffi.load(libPath)
  const KeyCallback = koffi.proto('void JustSayKeyCallback(const char *json)')
  const startMonitor = lib.func('int startMonitor(JustSayKeyCallback *cb)')
  const stopMonitor = lib.func('void stopMonitor()')
  const updateTargetShortcuts = lib.func('int updateTargetShortcuts(const char *json)')
  const resetPressingKeycodes = lib.func('void resetPressingKeycodes()')
  const setWatcherInterval = lib.func('void setWatcherInterval(int ms)')
  const getKeyboardDeviceList = lib.func('const char *getKeyboardDeviceList()')

  const callback = koffi.register((json: string) => {
    send({ type: 'keyboard-event', data: JSON.parse(json) })
  }, koffi.pointer(KeyCallback))

  if (startMonitor(callback) !== 1) throw new Error('startMonitor falhou: o hook não foi instalado')

  const shutdown = (code: number) => {
    stopMonitor()
    koffi.unregister(callback)
    process.exit(code)
  }

  process.on('message', (raw) => {
    const msg = raw as ParentMessage
    switch (msg.type) {
      case 'updateTargetShortcuts':
        updateTargetShortcuts(JSON.stringify(msg.shortcuts))
        break
      case 'resetPressingKeycodes':
        resetPressingKeycodes()
        break
      case 'setWatcherInterval':
        setWatcherInterval(msg.ms)
        break
      case 'getKeyboardDeviceList':
        send({ type: 'keyboard-device-list', requestId: msg.requestId, data: JSON.parse(getKeyboardDeviceList()) })
        break
      case 'stop':
        shutdown(0)
        break
    }
  })
  // Main morreu: não deixa um hook órfão no sistema.
  process.on('disconnect', () => shutdown(0))

  send({ type: 'ready', pid: process.pid })
}

try {
  main()
} catch (err) {
  const message = { type: 'fatal', message: err instanceof Error ? err.message : String(err) }
  // Espera a mensagem sair antes de encerrar.
  if (process.send) process.send(message, () => process.exit(1))
  else process.exit(1)
}
