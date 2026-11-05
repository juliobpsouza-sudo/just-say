// Monta o `audio_context` completo a partir do que a ContextHelper.dll leu.
// Função pura: os limites e cortes de texto ficam aqui (testados em tests/audioContext.test.ts).
import { LIMITS } from './constants'
import type { ContextPolicy } from './contextLists'
import { cleanScreenText, keepHead, keepTail, truncateMiddle } from './tokens'

export interface Probe {
  name: string
  ms: number
  ok: boolean
  timedOut: boolean
}

export interface RawAppCapture {
  app: {
    pid: number
    exePath: string
    exeName: string
    title: string
    windowClass: string
    bounds: { x: number; y: number; w: number; h: number }
    isBrowser: boolean
    hasCaret: boolean
    isElevated: boolean | null
  }
  browser: { url: string; pageTitle: string } | null
  probes: Probe[]
}

export interface RawFocusCapture {
  focused: {
    controlType: number
    localizedType: string
    name: string
    className: string
    frameworkId: string
    automationId: string
    placeholder: string
    ariaRole: string
    isEditable: boolean
    isPassword: boolean
    isMultiline: boolean
    hasTextPattern: boolean
    hasValuePattern: boolean
    bounds: { x: number; y: number; w: number; h: number }
    cursorKnown: boolean
    textBefore: string
    textAfter: string
    selection: string
    fullText: string
    beforeCharsRequested: number
    beforeCharsActual: number
    afterCharsRequested: number
    afterCharsActual: number
  } | null
  visibleText?: string
  visibleSource?: 'document' | 'tree' | 'none'
  surrounding?: { before: string; after: string }
  probes: Probe[]
}

export interface DeviceEnvironment {
  os: string
  os_version: string
  arch: string
  locale: string
  region: string
  manufacturer: string | null
  model: string | null
  uptime_s: number
}

export type CaptureMode = 'full' | 'blocked' | 'off' | 'minimal'

/** Nomes amigáveis para os executáveis mais comuns. */
const APP_NAMES: Record<string, string> = {
  'chrome.exe': 'Google Chrome',
  'msedge.exe': 'Microsoft Edge',
  'firefox.exe': 'Firefox',
  'brave.exe': 'Brave',
  'code.exe': 'VS Code',
  'cursor.exe': 'Cursor',
  'notepad.exe': 'Bloco de Notas',
  'whatsapp.exe': 'WhatsApp',
  'telegram.exe': 'Telegram',
  'discord.exe': 'Discord',
  'slack.exe': 'Slack',
  'obsidian.exe': 'Obsidian',
  'notion.exe': 'Notion',
  'winword.exe': 'Word',
  'excel.exe': 'Excel',
  'outlook.exe': 'Outlook',
  'olk.exe': 'Outlook',
  'ms-teams.exe': 'Teams',
  'claude.exe': 'Claude',
}

export function appDisplayName(exeName: string): string {
  return APP_NAMES[exeName.toLowerCase()] ?? exeName.replace(/\.exe$/i, '')
}

export interface BuildContextInput {
  app: RawAppCapture | null
  focus: RawFocusCapture | null
  policy: ContextPolicy | null
  device: DeviceEnvironment | null
  captureMs: number
}

export function buildFullAudioContext(input: BuildContextInput): Record<string, unknown> {
  const { app, focus, policy, device } = input
  const f = focus?.focused ?? null
  const blocked = policy?.blockScreen ?? false
  const mode: CaptureMode = !app ? 'minimal' : policy?.blockReason === 'setting_off' ? 'off' : blocked ? 'blocked' : 'full'
  const text = (s: string | undefined | null) => (blocked ? '' : cleanScreenText(s))

  const related = LIMITS.RELATED_TEXT_BEFORE_TOKENS
  const relatedAfter = LIMITS.RELATED_TEXT_AFTER_TOKENS

  return {
    context_metadata: {
      version: 'just-say-2',
      lists_version: 'just-say-1.0.0',
      capture: mode,
      blocked_reason: policy?.blockReason ?? null,
      capture_ms: input.captureMs,
      probes: [...(app?.probes ?? []), ...(focus?.probes ?? [])],
      visible_source: focus?.visibleSource ?? 'none',
    },
    device_environment: device,
    active_application: app
      ? {
          name: appDisplayName(app.app.exeName),
          executable: app.app.exeName,
          path: app.app.exePath,
          window_title: app.app.title,
          bounds: app.app.bounds,
          type: app.app.isBrowser ? 'web_browser' : 'native_app',
          pid: app.app.pid,
          is_elevated: app.app.isElevated,
          visible_screen_content: truncateMiddle(text(focus?.visibleText), LIMITS.VISIBLE_TEXT_TOKENS),
          browser_context: app.browser
            ? {
                page_title: app.browser.pageTitle,
                // Com a leitura desligada ou num site bloqueado, vai só o domínio.
                page_url: blocked ? null : app.browser.url,
                domain: policy?.domain ?? null,
              }
            : null,
        }
      : null,
    text_insertion_point: f
      ? {
          field_type: f.localizedType,
          accessibility_role: f.ariaRole || f.localizedType,
          bounds: f.bounds,
          input_capabilities: {
            // O cursor do sistema só ajuda fora do Chromium; lá a acessibilidade é confiável (D61).
            is_editable: f.isEditable || (f.frameworkId !== CHROMIUM_FRAMEWORK && (app?.app.hasCaret ?? false)),
            supports_markdown: policy?.supportsMarkdown ?? false,
            is_multiline: f.isMultiline,
            is_password: f.isPassword,
            placeholder: blocked ? '' : f.placeholder,
            dom_id: f.automationId,
            dom_classes: f.className,
            framework: f.frameworkId,
          },
          cursor_state: {
            known: f.cursorKnown,
            selection: truncateMiddle(text(f.selection), LIMITS.SELECTED_TEXT_TOKENS),
            text_before: keepTail(text(f.textBefore), related),
            text_after: keepHead(text(f.textAfter), relatedAfter),
            full_text: truncateMiddle(text(f.fullText), related + relatedAfter),
          },
          surrounding_context: {
            before: keepTail(text(focus?.surrounding?.before), related),
            after: keepHead(text(focus?.surrounding?.after), relatedAfter),
          },
        }
      : { input_capabilities: { is_editable: app?.app.hasCaret ?? null, supports_markdown: policy?.supportsMarkdown ?? false } },
  }
}

/** `frameworkId` que a UI Automation informa para Chrome, Edge, Electron e WebView2. */
export const CHROMIUM_FRAMEWORK = 'Chrome'

/**
 * Mostrar o cartão "clique para copiar" junto com a colagem (D52, D61)?
 * Sim sempre que não dá para confirmar que há um campo editável. Na dúvida, mostra: cartão
 * a mais não faz mal (o texto é colado do mesmo jeito); cartão a menos perde o ditado.
 * A lista de apps editáveis (terminais, Office…) só vale fora do Chromium, onde a
 * acessibilidade é confiável e o "não editável" é de verdade.
 */
export function shouldShowCopyCard(audioContext: Record<string, unknown> | null | undefined, editableWhitelisted: boolean): boolean {
  const field = ((audioContext ?? {}) as Record<string, any>).text_insertion_point ?? {}
  const caps = field.input_capabilities ?? {}
  if (caps.is_editable === true) return false
  const chromiumFocus = caps.framework === CHROMIUM_FRAMEWORK
  return !(editableWhitelisted && !chromiumFocus)
}

/** Resumo para o Painel: o que foi lido, de onde e em quanto tempo. */
export interface ContextSummary {
  app: string | null
  site: string | null
  field: string | null
  editable: boolean | null
  mode: string
  blockedReason: string | null
  visibleChars: number
  beforeChars: number
  afterChars: number
  captureMs: number | null
  timedOut: string[]
}

export function summarizeAudioContext(ctx: Record<string, unknown> | null | undefined): ContextSummary {
  const c = (ctx ?? {}) as Record<string, any>
  const app = c.active_application ?? null
  const field = c.text_insertion_point ?? null
  const meta = c.context_metadata ?? {}
  return {
    app: app?.name ?? null,
    site: app?.browser_context?.domain ?? null,
    field: field?.field_type ?? null,
    editable: field?.input_capabilities?.is_editable ?? null,
    mode: meta.capture ?? 'minimal',
    blockedReason: meta.blocked_reason ?? null,
    visibleChars: (app?.visible_screen_content ?? '').length,
    beforeChars: (field?.cursor_state?.text_before ?? '').length + (field?.surrounding_context?.before ?? '').length,
    afterChars: (field?.cursor_state?.text_after ?? '').length + (field?.surrounding_context?.after ?? '').length,
    captureMs: meta.capture_ms ?? null,
    timedOut: (meta.probes ?? []).filter((p: Probe) => p.timedOut).map((p: Probe) => p.name),
  }
}
