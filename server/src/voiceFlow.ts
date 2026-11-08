// Fluxo de voz: áudio → STT (cascata) → conforme o modo → resposta para o app.
// - Ditado: refino e cola.
// - Tradução: limpa e traduz para o idioma de destino.
// - Just Ask: decide entre colar, responder (cartão), buscar na web ou abrir um link.
// Usado pelo POST /ai/voice_flow e, na Fase 4, pelo WebSocket.
import { hasSpeechEnergy } from './audioLevel.ts'
import { localLlmModel, warmLocal } from './localAi.ts'
import { config } from './config.ts'
import { dictionaryTerms } from './db.ts'
import { AllProvidersFailedError, allNetworkFailures, type Attempt } from './providers/cascade.ts'
import { llmCascade, searchCascade, sttCascade } from './providers/registry.ts'
import type { SearchSource, SttResult } from './providers/types.ts'
import { buildNotices } from './usageReport.ts'
import {
  askSystemPrompt,
  buildAskUserMessage,
  buildSearchUserMessage,
  cleanSearchAnswer,
  parseAskDecision,
  safeExternalUrl,
  searchSystemPrompt,
  type AskAction,
  type AskDecision,
} from './refine/askPrompts.ts'
import { languageName } from './refine/languages.ts'
import {
  autoCapitalize,
  buildDictationUserMessage,
  buildSttPrompt,
  DICTATION_SYSTEM_PROMPT,
  extractRefinedText,
  isSttArtifact,
  localRefineIsSafe,
  type DictationContext,
} from './refine/prompts.ts'
import { buildTranslationUserMessage, translationSystemPrompt } from './refine/translatePrompts.ts'
import { countStyleSample, stylePromptSection } from './style.ts'
import {
  cleanPageTitle,
  createNote,
  defaultFolderId,
  folderFromCommand,
  listFolders,
  notionConfigured,
  NotionError,
  pickFolder,
} from './integrations/notion.ts'
import { fetchLinkTitle, firstUrl } from './integrations/linkTitle.ts'

export type VoiceFlowMode = 'voice_transcript' | 'voice_command' | 'voice_translation'

export const VOICE_FLOW_MODES: readonly VoiceFlowMode[] = ['voice_transcript', 'voice_command', 'voice_translation']

export interface VoiceFlowInput {
  audioId: string
  mode: VoiceFlowMode
  audio: Buffer
  filename: string
  mimeType: string
  audioContext: unknown
  parameters: Record<string, unknown>
  isRetry: boolean
}

export interface WebMetadata {
  query: string
  sources: SearchSource[]
}

export interface ExternalAction {
  type: 'open_url'
  target: string
}

/** Resultado de uma integração (D72): o app mostra o aviso com Abrir e Desfazer. */
export interface IntegrationResult {
  service: 'notion'
  folder: string
  title: string
  note_kind: 'page' | 'block'
  note_id: string
  note_url: string | null
}

export interface AskDebug {
  action: AskAction
  search?: { provider: string; ms: number; attempts: Attempt[]; queries: string[] }
}

export interface VoiceFlowOutput {
  refine_text: string
  /** `notice` (extensão nossa): o resultado é só um aviso na barra (ex.: anotado no Notion). */
  delivery: 'replace' | 'reply' | 'external' | 'notice'
  user_prompt: string | null
  web_metadata: WebMetadata | null
  external_action: ExternalAction | null
  integration_result: IntegrationResult | null
  /** Avisos de uso gratuito para a barra (extensão nossa). */
  notices: string[]
  /** Hora de refazer o perfil de estilo pessoal: o app manda os ditados recentes (D65). */
  style_refresh_due: boolean
  debug: {
    transcript: string
    /** O que o STT devolveu e foi descartado por não ser fala (D79). */
    discarded_transcript?: string
    /** O áudio era silêncio e nem foi ao STT (D88). */
    silence?: true
    language: string | null
    stt: { provider: string; ms: number; attempts: Attempt[] }
    refine: { provider: string; ms: number; attempts: Attempt[] }
    /** Just Ask: o que o modelo decidiu e, se buscou, a busca. */
    ask?: AskDebug
    total_ms: number
  }
}

export class VoiceFlowError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly attempts: Attempt[] = [],
    /** Campos extras para o cliente (ex.: a transcrição, quando a tradução falha). */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

/** "pt-BR" → "pt". Só fixa o idioma do STT quando a pessoa escolheu exatamente um. */
export function sttLanguage(parameters: Record<string, unknown>): string | undefined {
  const langs = parameters.languages
  if (!Array.isArray(langs) || langs.length !== 1 || typeof langs[0] !== 'string') return undefined
  const code = langs[0].split(/[-_]/)[0].toLowerCase()
  return /^[a-z]{2,3}$/.test(code) ? code : undefined
}

/** Extrai do audio_context o que o prompt de refino usa. */
export function dictationContextFrom(audioContext: unknown): DictationContext {
  const ctx = (audioContext ?? {}) as Record<string, any>
  const app = (ctx.active_application ?? {}) as Record<string, any>
  const field = (ctx.text_insertion_point ?? {}) as Record<string, any>
  const caps = (field.input_capabilities ?? field) as Record<string, any>
  const cursor = (field.cursor_state ?? {}) as Record<string, any>
  const around = (field.surrounding_context ?? {}) as Record<string, any>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : undefined)
  // Textos longos: o corte fino é feito no prompt; aqui só um teto de segurança.
  const long = (v: unknown) => (typeof v === 'string' && v.trim() ? v.slice(0, 60_000) : undefined)
  return {
    appName: str(app.name),
    executable: str(app.executable),
    windowTitle: str(app.window_title),
    appType: app.type === 'web_browser' ? 'web_browser' : app.type === 'native_app' ? 'native_app' : undefined,
    domain: str(app.browser_context?.domain),
    pageTitle: str(app.browser_context?.page_title),
    pageUrl: typeof app.browser_context?.page_url === 'string' ? app.browser_context.page_url.slice(0, 2048) : undefined,
    supportsMarkdown: caps.supports_markdown === true,
    fieldRole: str(field.accessibility_role ?? field.role),
    placeholder: str(caps.placeholder),
    visibleText: long(app.visible_screen_content),
    fieldBefore: long(cursor.text_before),
    fieldAfter: long(cursor.text_after),
    pageBefore: long(around.before),
    pageAfter: long(around.after),
  }
}

/** O campo em foco parece editável? null = não deu para saber. */
export function fieldEditableFrom(audioContext: unknown): boolean | null {
  const field = ((audioContext ?? {}) as Record<string, any>).text_insertion_point ?? {}
  const value = field.input_capabilities?.is_editable ?? field.is_editable
  return typeof value === 'boolean' ? value : null
}

/** "terça-feira, 14 de outubro de 2026", para o modelo saber o que é "hoje". */
export function todayLabel(now = new Date()): string {
  return now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

interface StepResult {
  refineText: string
  delivery: VoiceFlowOutput['delivery']
  userPrompt: string | null
  webMetadata: WebMetadata | null
  externalAction: ExternalAction | null
  integration?: IntegrationResult
  provider: string
  attempts: Attempt[]
  /** Provedores usados com sucesso (para os avisos de uso). */
  usedIds: string[]
  ask?: AskDebug
  styleRefreshDue?: boolean
  /** Limpeza do modelo local recusada pela checagem (D94). */
  localRejected?: boolean
}

function emptyStep(): StepResult {
  return {
    refineText: '',
    delivery: 'replace',
    userPrompt: null,
    webMetadata: null,
    externalAction: null,
    provider: 'none',
    attempts: [],
    usedIds: [],
  }
}

export async function runVoiceFlow(input: VoiceFlowInput): Promise<VoiceFlowOutput> {
  const started = Date.now()
  const deadline = started + (input.mode === 'voice_command' ? config.askDeadlineMs : config.voiceFlowDeadlineMs)

  // Tradução sem idioma de destino conhecido: nem gasta a transcrição.
  const targetLanguage = input.mode === 'voice_translation' ? languageName(input.parameters.output_language) : null
  if (input.mode === 'voice_translation' && !targetLanguage)
    throw new VoiceFlowError('bad_language', 400, 'Idioma de destino da tradução ausente ou desconhecido.')

  // Ligou e soltou sem falar: silêncio total nem vai ao Whisper, que inventaria texto (D88).
  if (hasSpeechEnergy(input.audio) === false) return silentOutput(Date.now() - started)

  const glossary = dictionaryTerms()
  const sttPrompt = buildSttPrompt(glossary)

  // 1. Transcrição
  let stt: { provider: { id: string }; value: SttResult; attempts: Attempt[] }
  try {
    stt = await sttCascade.run(
      (provider, signal) =>
        provider.transcribe({
          audio: input.audio,
          filename: input.filename,
          mimeType: input.mimeType,
          // A fala da tradução e o pedido do Just Ask podem vir em qualquer idioma.
          language: input.mode === 'voice_transcript' ? sttLanguage(input.parameters) : undefined,
          prompt: sttPrompt,
          signal,
        }),
      { deadline, perProviderTimeoutMs: config.sttTimeoutMs },
    )
  } catch (err) {
    if (err instanceof AllProvidersFailedError && allNetworkFailures(err.attempts))
      throw new VoiceFlowError('offline', 503, 'Sem conexão com a internet.', err.attempts)
    if (err instanceof AllProvidersFailedError)
      throw new VoiceFlowError('stt_unavailable', 503, 'Nenhum provedor de transcrição respondeu.', err.attempts)
    throw err
  }
  const sttMs = Date.now() - started
  // Groq sem internet ou fora: a limpeza também vai precisar do modelo local. Começa a ligar
  // agora, enquanto a transcrição termina, para não estourar o prazo do refino (D94).
  if (stt.provider.id === 'local:whisper' || stt.attempts.some((a) => a.failure === 'network')) warmLocal('llm')
  // Toque sem fala: o Whisper ecoa o prompt ("Termos.") ou inventa uma legenda. Vira "nenhuma fala" (D79).
  const discarded = isSttArtifact(stt.value.text, sttPrompt) && stt.value.text.trim() !== ''
  const transcript = discarded ? '' : stt.value.text

  // 2. Conforme o modo
  const stepStarted = Date.now()
  const step = !transcript
    ? emptyStep()
    : input.mode === 'voice_command'
      ? await askAnything(input, transcript, deadline)
      : input.mode === 'voice_translation'
        ? await translate(input, transcript, targetLanguage!, glossary, deadline)
        : await refineDictation(input, transcript, glossary, deadline)

  return {
    refine_text: step.refineText,
    delivery: step.delivery,
    user_prompt: step.userPrompt,
    web_metadata: step.webMetadata,
    external_action: step.externalAction,
    integration_result: step.integration ?? null,
    notices: buildNotices([...stt.attempts, ...step.attempts], [stt.provider.id, ...step.usedIds]),
    style_refresh_due: step.styleRefreshDue === true,
    debug: {
      transcript,
      ...(discarded ? { discarded_transcript: stt.value.text } : {}),
      language: stt.value.language ?? null,
      stt: { provider: stt.provider.id, ms: sttMs, attempts: stt.attempts },
      refine: {
        provider: step.provider === 'local:llm' ? `local:llm (${localLlmModel() ?? '?'})` : step.provider,
        ms: Date.now() - stepStarted,
        attempts: step.attempts,
        ...(step.localRejected ? { local_rejected: true } : {}),
      },
      ...(step.ask ? { ask: step.ask } : {}),
      total_ms: Date.now() - started,
    },
  }
}

/** Resposta para áudio sem som: texto vazio, que o app mostra como "Nenhuma fala detectada". */
function silentOutput(ms: number): VoiceFlowOutput {
  const step = emptyStep()
  return {
    refine_text: '',
    delivery: step.delivery,
    user_prompt: null,
    web_metadata: null,
    external_action: null,
    integration_result: null,
    notices: [],
    style_refresh_due: false,
    debug: {
      transcript: '',
      silence: true,
      language: null,
      stt: { provider: 'none', ms: 0, attempts: [] },
      refine: { provider: 'none', ms: 0, attempts: [] },
      total_ms: ms,
    },
  }
}

// ---------- ditado ----------

async function refineDictation(
  input: VoiceFlowInput,
  transcript: string,
  glossary: string[],
  deadline: number,
): Promise<StepResult> {
  const step = emptyStep()
  try {
    const result = await llmCascade.run(
      (provider, signal) =>
        provider.complete({
          system: DICTATION_SYSTEM_PROMPT,
          user: buildDictationUserMessage(
            transcript,
            dictationContextFrom(input.audioContext),
            glossary,
            stylePromptSection(),
            provider.local ? 0.5 : 1,
          ),
          maxTokens: Math.min(4096, Math.ceil(transcript.length / 2) + 256),
          fallbackText: transcript,
          signal,
        }),
      // O refino nunca pode deixar o ditado sem resposta: se o prazo acabar, cola a transcrição.
      { deadline: Math.max(deadline, Date.now() + 1000), perProviderTimeoutMs: config.llmTimeoutMs },
    )
    step.provider = result.provider.id
    step.attempts = result.attempts
    step.refineText = result.provider.passthrough ? result.value : extractRefinedText(result.value)
    // Modelo local que cortou conteúdo ou inventou um termo do dicionário: cola a transcrição (D94).
    if (result.provider.local && !localRefineIsSafe(transcript, step.refineText, glossary)) {
      console.log(`[ia local] limpeza recusada pela checagem; colando a transcrição`)
      step.refineText = transcript
      step.localRejected = true
    }
    // Estilo pessoal: conta o ditado e avisa o app quando é hora de refazer o perfil (D65).
    if (!result.provider.passthrough && !result.provider.local && step.refineText) step.styleRefreshDue = countStyleSample()
  } catch (err) {
    if (!(err instanceof AllProvidersFailedError)) throw err
    step.attempts = err.attempts
    step.refineText = transcript
  }
  // Toda frase começa com maiúscula, mesmo se o modelo ou o "sem refino" deixarem minúscula (D91).
  step.refineText = autoCapitalize(step.refineText, dictationContextFrom(input.audioContext))
  if (step.provider !== 'none') step.usedIds = [step.provider]
  return step
}

// ---------- tradução ----------

async function translate(
  input: VoiceFlowInput,
  transcript: string,
  targetLanguage: string,
  glossary: string[],
  deadline: number,
): Promise<StepResult> {
  try {
    const result = await llmCascade.run(
      (provider, signal) =>
        provider.complete({
          system: translationSystemPrompt(targetLanguage),
          user: buildTranslationUserMessage(transcript, dictationContextFrom(input.audioContext), glossary),
          // Alguns idiomas gastam mais tokens que o português (japonês, chinês, árabe).
          maxTokens: Math.min(4096, transcript.length + 256),
          fallbackText: transcript,
          signal,
        }),
      // Sem o degrau "sem refino": colar o texto sem traduzir seria errado (D56).
      { deadline, perProviderTimeoutMs: config.llmTimeoutMs, skip: (p) => p.passthrough === true || p.local === true },
    )
    return {
      ...emptyStep(),
      refineText: autoCapitalize(extractRefinedText(result.value), dictationContextFrom(input.audioContext)),
      provider: result.provider.id,
      attempts: result.attempts,
      usedIds: [result.provider.id],
    }
  } catch (err) {
    if (!(err instanceof AllProvidersFailedError)) throw err
    throw new VoiceFlowError(
      'translation_unavailable',
      503,
      'Os modelos gratuitos não responderam para traduzir.',
      err.attempts,
      { transcript },
    )
  }
}

// ---------- Just Ask ----------

/**
 * Teto de saída do Just Ask. Até 1000 tokens cabe no limite por minuto do Qwen (D57);
 * reescrever uma seleção grande precisa de mais, e aí o pedido vai para o próximo modelo.
 */
export function askMaxTokens(selected: string): number {
  return Math.min(4096, Math.max(1000, Math.ceil(selected.length / 3) + 600))
}

async function askAnything(input: VoiceFlowInput, command: string, deadline: number): Promise<StepResult> {
  const context = dictationContextFrom(input.audioContext)
  const selected = typeof input.parameters.selected_text === 'string' ? input.parameters.selected_text : ''
  const today = todayLabel()
  // Nomes das pastas do Notion, para o "anotar" acertar a pasta (cache de 60 s; no máximo 800 ms).
  const notionFolders = notionConfigured()
    ? await Promise.race([
        listFolders()
          .then((list) => list.map((x) => x.title))
          .catch(() => [] as string[]),
        new Promise<string[]>((r) => setTimeout(() => r([]), 800)),
      ])
    : []

  let decided
  try {
    decided = await llmCascade.run(
      (provider, signal) =>
        provider.complete({
          system: askSystemPrompt(today),
          user: buildAskUserMessage({
            command,
            selectedText: selected,
            context,
            // Seleção lida no documento da página (fora do campo focado): não dá para
            // substituí-la colando, então conta como "não editável" (D70).
            fieldEditable:
              input.parameters.selection_source === 'uia_document' && selected.trim()
                ? false
                : fieldEditableFrom(input.audioContext),
            notionFolders,
          }),
          maxTokens: askMaxTokens(selected),
          fallbackText: '',
          signal,
        }),
      { deadline, perProviderTimeoutMs: config.askLlmTimeoutMs, skip: (p) => p.passthrough === true || p.local === true },
    )
  } catch (err) {
    if (!(err instanceof AllProvidersFailedError)) throw err
    throw new VoiceFlowError('ask_unavailable', 503, 'Os modelos gratuitos não responderam ao pedido.', err.attempts)
  }

  const decision = parseAskDecision(decided.value, command, selected.trim().length > 0)
  const base: StepResult = {
    ...emptyStep(),
    userPrompt: command,
    provider: decided.provider.id,
    attempts: decided.attempts,
    usedIds: [decided.provider.id],
    ask: { action: decision.action },
  }

  if (decision.action === 'colar') return { ...base, refineText: decision.text, delivery: 'replace' }
  if (decision.action === 'responder') return { ...base, refineText: decision.text, delivery: 'reply' }
  if (decision.action === 'anotar') return { ...base, ...(await noteToNotion(decision, command, context, selected)) }
  if (decision.action === 'abrir')
    return {
      ...base,
      refineText: decision.url,
      delivery: 'external',
      externalAction: { type: 'open_url', target: decision.url },
    }

  // buscar
  const searchStarted = Date.now()
  try {
    const found = await searchCascade.run(
      (provider, signal) =>
        provider.search({
          system: searchSystemPrompt(today),
          user: buildSearchUserMessage(command, decision.query, context, selected),
          maxTokens: 1500,
          signal,
        }),
      { deadline, perProviderTimeoutMs: config.searchTimeoutMs },
    )
    return {
      ...base,
      refineText: cleanSearchAnswer(found.value.answer) || 'Não achei uma resposta na busca.',
      delivery: 'reply',
      webMetadata: { query: found.value.queries[0] ?? decision.query, sources: found.value.sources },
      attempts: [...base.attempts, ...found.attempts],
      usedIds: [...base.usedIds, found.provider.id],
      ask: {
        action: 'buscar',
        search: {
          provider: found.provider.id,
          ms: Date.now() - searchStarted,
          attempts: found.attempts,
          queries: found.value.queries,
        },
      },
    }
  } catch (err) {
    if (!(err instanceof AllProvidersFailedError)) throw err
    throw new VoiceFlowError('search_unavailable', 503, 'A busca na web não respondeu agora.', [
      ...base.attempts,
      ...err.attempts,
    ])
  }
}

// ---------- anotar no Notion (D72) ----------

const REFERS_TO_PAGE = /(?<![\p{L}])(v[ií]deo|p[aá]gina|link|site|artigo|post|reposit[oó]rio|repo|projeto|isso aqui|esse aqui|essa aqui)(?![\p{L}])/iu

async function noteToNotion(
  decision: AskDecision,
  command: string,
  context: DictationContext,
  selected: string,
): Promise<Partial<StepResult>> {
  const reply = (text: string): Partial<StepResult> => ({ refineText: text, delivery: 'reply' })
  if (!notionConfigured())
    return reply(
      'Para anotar no Notion, conecte primeiro: crie a integração "Just Say" no Notion, ponha a chave em server\\.env (NOTION_TOKEN) e conecte a página da pasta a ela. O passo a passo está em Conectores → Notion.',
    )
  try {
    const folders = await listFolders()
    if (!folders.length)
      return reply('Nenhuma página do seu Notion está conectada ao Just Say. Na página da pasta, abra ⋯ → Conexões → Just Say.')
    // Sem pasta falada nem deduzida pelo modelo: tenta pelo tipo de coisa no pedido (D90).
    const folder = decision.folder
      ? pickFolder(folders, decision.folder, defaultFolderId())
      : (folderFromCommand(folders, command) ?? pickFolder(folders, '', defaultFolderId()))
    if (!folder)
      return reply(
        `Não sei em qual pasta anotar${decision.folder ? ` ("${decision.folder}")` : ''}. Pastas conectadas: ${folders
          .map((x) => x.title)
          .join(', ')}. Diga o nome da pasta ou escolha uma padrão em Conectores → Notion.`,
      )
    // O link da nota (D73): o que o modelo trouxe; senão o primeiro link do texto selecionado
    // (ex.: um link no WhatsApp); senão, para "esse vídeo / essa página", o da página aberta.
    const selectionUrl = safeExternalUrl(firstUrl(selected))
    const openPageUrl = context.pageUrl && REFERS_TO_PAGE.test(command) ? context.pageUrl : ''
    const url = decision.url || selectionUrl || openPageUrl
    const pageTitle = context.pageTitle ? cleanPageTitle(context.pageTitle) : ''
    const isOpenPage = Boolean(url && context.pageUrl && sameUrl(url, context.pageUrl))
    // Link que não é a página aberta: o título verdadeiro vem do próprio link (YouTube pelo
    // oEmbed, outros sites pela página). A página aberta já tem o título certo.
    const fetchedTitle = url && !isOpenPage ? await fetchLinkTitle(url) : null
    const title = (
      fetchedTitle ||
      (isOpenPage && pageTitle) ||
      decision.title ||
      (url && pageTitle) ||
      decision.text.split('\n')[0] ||
      'Nota do Just Say'
    ).slice(0, 200)
    // O texto da nota não repete o link nem o título. Se o link veio da seleção (ex.: uma
    // mensagem do WhatsApp), o resto da mensagem não entra: o item fica só com título e link.
    const modelText = decision.text && decision.text !== title ? decision.text : ''
    const rawText = modelText || (selectionUrl ? '' : selected.trim().slice(0, 1500))
    const text = url ? rawText.split(url).join('').replace(/\s+/g, ' ').trim() : rawText
    const note = await createNote(folder, { title, url: url || null, text: text || null })
    console.log(`[notion] nota criada em uma pasta (${note.kind})`)
    return {
      refineText: `Anotado em "${folder.title}" no Notion: ${title}`,
      delivery: 'notice',
      integration: {
        service: 'notion',
        folder: folder.title,
        title,
        note_kind: note.kind,
        note_id: note.id,
        note_url: note.url,
      },
    }
  } catch (err) {
    if (err instanceof NotionError) return reply(`Não consegui anotar no Notion: ${err.message}`)
    throw err
  }
}

/** Mesmo endereço, ignorando "www.", a barra do fim e o "#trecho". */
export function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const x = new URL(u)
      return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/$/, '')}${x.search}`
    } catch {
      return u
    }
  }
  return norm(a) === norm(b)
}
