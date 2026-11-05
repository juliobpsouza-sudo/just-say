import { describe, expect, it } from 'vitest'
import {
  buildFullAudioContext,
  shouldShowCopyCard,
  summarizeAudioContext,
  type RawAppCapture,
  type RawFocusCapture,
} from '../src/shared/audioContext'
import { DEFAULT_BLOCKED_APPS, DEFAULT_BLOCKED_SITES, contextPolicy, domainOf } from '../src/shared/contextLists'
import { spaceBeforeInsert } from '../src/shared/insertSpacing'
import { cleanScreenText, estimateTokens, keepHead, keepTail, MIDDLE_MARKER, truncateMiddle } from '../src/shared/tokens'

describe('tokens e cortes', () => {
  it('estima ~4 caracteres por token e 1 por ideograma', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcdefgh')).toBe(2)
    expect(estimateTokens('你好')).toBe(2)
  })

  it('corta pelo meio mantendo começo e fim', () => {
    const text = 'A'.repeat(400) + 'B'.repeat(400)
    const out = truncateMiddle(text, 50)
    expect(estimateTokens(out)).toBeLessThanOrEqual(51)
    expect(out.startsWith('AAAA')).toBe(true)
    expect(out.endsWith('BBBB')).toBe(true)
    expect(out).toContain(MIDDLE_MARKER)
  })

  it('texto que cabe não muda', () => {
    expect(truncateMiddle('curto', 100)).toBe('curto')
  })

  it('antes do cursor mantém o fim; depois do cursor mantém o começo', () => {
    const text = '0123456789'.repeat(20)
    expect(keepTail(text, 5)).toBe(text.slice(-20))
    expect(keepHead(text, 5)).toBe(text.slice(0, 20))
  })

  it('limpa o caractere de objeto e linhas vazias demais', () => {
    expect(cleanScreenText('\uFFFCOi\n\n\n\n mundo  ')).toBe('Oi\n\n mundo')
  })
})

describe('listas de apps e sites', () => {
  const base = { readScreenContext: true, blockedApps: DEFAULT_BLOCKED_APPS, blockedSites: DEFAULT_BLOCKED_SITES }

  it('extrai o domínio sem www', () => {
    expect(domainOf('https://www.youtube.com/watch?v=x')).toBe('youtube.com')
    expect(domainOf(null)).toBeNull()
  })

  it('bloqueia app da lista e site da lista, inclusive subdomínio', () => {
    expect(contextPolicy({ ...base, exeName: 'KeePassXC.exe', url: null }).blockReason).toBe('blocked_app')
    expect(contextPolicy({ ...base, exeName: 'chrome.exe', url: 'https://www2.bb.com.br/x' }).blockReason).toBe('blocked_site')
    expect(contextPolicy({ ...base, exeName: 'chrome.exe', url: 'https://www.youtube.com' }).blockScreen).toBe(false)
  })

  it('não confunde domínio parecido', () => {
    expect(contextPolicy({ ...base, exeName: 'chrome.exe', url: 'https://notbb.com.br' }).blockScreen).toBe(false)
  })

  it('leitura desligada vale para tudo', () => {
    expect(contextPolicy({ ...base, readScreenContext: false, exeName: 'notepad.exe', url: null }).blockReason).toBe('setting_off')
  })

  it('marca apps editáveis e com markdown', () => {
    const vs = contextPolicy({ ...base, exeName: 'Code.exe', url: null })
    expect(vs.editableWhitelisted).toBe(true)
    expect(contextPolicy({ ...base, exeName: 'chrome.exe', url: 'https://github.com/a/b' }).supportsMarkdown).toBe(true)
  })
})

describe('audio_context completo', () => {
  const app: RawAppCapture = {
    app: {
      pid: 1,
      exePath: 'C:\\chrome.exe',
      exeName: 'chrome.exe',
      title: 'Gmail',
      windowClass: 'Chrome_WidgetWin_1',
      bounds: { x: 0, y: 0, w: 100, h: 100 },
      isBrowser: true,
      hasCaret: false,
      isElevated: false,
    },
    browser: { url: 'https://mail.google.com/mail/u/0', pageTitle: 'Caixa de entrada' },
    probes: [{ name: 'app', ms: 1, ok: true, timedOut: false }],
  }
  const focus: RawFocusCapture = {
    focused: {
      controlType: 50004,
      localizedType: 'editar',
      name: 'Mensagem',
      className: 'editable',
      frameworkId: 'Chrome',
      automationId: 'msg',
      placeholder: 'Escreva',
      ariaRole: 'textbox',
      isEditable: true,
      isPassword: false,
      isMultiline: true,
      hasTextPattern: true,
      hasValuePattern: true,
      bounds: { x: 0, y: 0, w: 10, h: 10 },
      cursorKnown: true,
      textBefore: 'Oi Moreira,',
      textAfter: '',
      selection: '',
      fullText: '',
      beforeCharsRequested: 4000,
      beforeCharsActual: 11,
      afterCharsRequested: 4000,
      afterCharsActual: 0,
    },
    visibleText: 'Moreira: bom dia\uFFFC',
    visibleSource: 'document',
    surrounding: { before: 'Para: moreira@x.com', after: '' },
    probes: [{ name: 'visible_text', ms: 300, ok: true, timedOut: false }],
  }
  const policy = contextPolicy({
    exeName: 'chrome.exe',
    url: app.browser!.url,
    readScreenContext: true,
    blockedApps: DEFAULT_BLOCKED_APPS,
    blockedSites: DEFAULT_BLOCKED_SITES,
  })

  it('preenche os três blocos do audio_context', () => {
    const ctx = buildFullAudioContext({ app, focus, policy, device: null, captureMs: 320 }) as any
    expect(ctx.active_application.name).toBe('Google Chrome')
    expect(ctx.active_application.type).toBe('web_browser')
    expect(ctx.active_application.browser_context).toEqual({
      page_title: 'Caixa de entrada',
      page_url: 'https://mail.google.com/mail/u/0',
      domain: 'mail.google.com',
    })
    expect(ctx.active_application.visible_screen_content).toBe('Moreira: bom dia')
    expect(ctx.text_insertion_point.cursor_state.text_before).toBe('Oi Moreira,')
    expect(ctx.text_insertion_point.input_capabilities.is_editable).toBe(true)
    expect(ctx.context_metadata.capture).toBe('full')
  })

  it('site bloqueado: nada de texto, e a URL vira só o domínio', () => {
    const blocked = { ...policy, blockScreen: true, blockReason: 'blocked_site' as const }
    const ctx = buildFullAudioContext({ app, focus, policy: blocked, device: null, captureMs: 10 }) as any
    expect(ctx.active_application.visible_screen_content).toBe('')
    expect(ctx.active_application.browser_context.page_url).toBeNull()
    expect(ctx.active_application.browser_context.domain).toBe('mail.google.com')
    expect(ctx.text_insertion_point.cursor_state.text_before).toBe('')
    expect(ctx.context_metadata.capture).toBe('blocked')
  })

  it('o resumo do Painel conta o que foi lido', () => {
    const s = summarizeAudioContext(buildFullAudioContext({ app, focus, policy, device: null, captureMs: 320 }))
    expect(s).toMatchObject({ app: 'Google Chrome', site: 'mail.google.com', editable: true, mode: 'full', captureMs: 320 })
    expect(s.visibleChars).toBe(16)
  })
})

describe('espaço antes do texto colado', () => {
  it('põe espaço quando o cursor está colado numa palavra', () => {
    expect(spaceBeforeInsert('Olá', 'mundo')).toBe(' mundo')
    expect(spaceBeforeInsert('Fim.', 'Novo começo')).toBe(' Novo começo')
  })
  it('não põe quando já tem espaço, abre parêntese ou o texto começa com pontuação', () => {
    expect(spaceBeforeInsert('Olá ', 'mundo')).toBe('mundo')
    expect(spaceBeforeInsert('(', 'nota')).toBe('nota')
    expect(spaceBeforeInsert('Olá', ', tudo bem')).toBe(', tudo bem')
    expect(spaceBeforeInsert('', 'mundo')).toBe('mundo')
  })
})

describe('cartão "clique para copiar" (D61)', () => {
  const ctx = (caps: Record<string, unknown> | null) => (caps ? { text_insertion_point: { input_capabilities: caps } } : {})

  it('campo editável confirmado: só cola', () => {
    expect(shouldShowCopyCard(ctx({ is_editable: true, framework: 'Chrome' }), false)).toBe(false)
    expect(shouldShowCopyCard(ctx({ is_editable: true, framework: 'Win32' }), true)).toBe(false)
  })
  it('sem campo ou sem como confirmar: mostra o cartão', () => {
    expect(shouldShowCopyCard(ctx({ is_editable: false, framework: 'Chrome' }), false)).toBe(true)
    expect(shouldShowCopyCard(ctx({ is_editable: null }), false)).toBe(true)
    expect(shouldShowCopyCard(ctx(null), false)).toBe(true)
    expect(shouldShowCopyCard(null, false)).toBe(true)
  })
  it('lista de editáveis vale fora do Chromium (terminal, Office)', () => {
    expect(shouldShowCopyCard(ctx({ is_editable: false, framework: 'Win32' }), true)).toBe(false)
    expect(shouldShowCopyCard(ctx({ is_editable: null }), true)).toBe(false)
  })
  it('dentro do Chromium a lista não esconde o cartão (ex.: Claude sem caixa de texto)', () => {
    expect(shouldShowCopyCard(ctx({ is_editable: false, framework: 'Chrome' }), true)).toBe(true)
  })
})

describe('raiz da página no Chromium não é campo', () => {
  it('o cursor do sistema não torna editável um foco do Chromium; fora dele, torna', () => {
    const app = (hasCaret: boolean): RawAppCapture => ({
      app: {
        pid: 1,
        exePath: 'C:\claude.exe',
        exeName: 'claude.exe',
        title: 'Claude',
        windowClass: 'Chrome_WidgetWin_1',
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        isBrowser: false,
        hasCaret,
        isElevated: false,
      },
      browser: null,
      probes: [],
    })
    const focus = (frameworkId: string): RawFocusCapture => ({
      focused: {
        controlType: 50030,
        localizedType: 'documento',
        name: '',
        className: '',
        frameworkId,
        automationId: '',
        placeholder: '',
        ariaRole: '',
        isEditable: false,
        isPassword: false,
        isMultiline: true,
        hasTextPattern: true,
        hasValuePattern: true,
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        cursorKnown: false,
        textBefore: '',
        textAfter: '',
        selection: '',
        fullText: '',
      },
      probes: [],
    } as unknown as RawFocusCapture)
    const editable = (frameworkId: string) =>
      (
        buildFullAudioContext({ app: app(true), focus: focus(frameworkId), policy: null, device: null, captureMs: 1 })
          .text_insertion_point as { input_capabilities: { is_editable: boolean } }
      ).input_capabilities.is_editable
    expect(editable('Chrome')).toBe(false)
    expect(editable('Win32')).toBe(true)
  })
})
