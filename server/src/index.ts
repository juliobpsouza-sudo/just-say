// Servidor local do Just Say. Escuta só em 127.0.0.1.
import multipart from '@fastify/multipart'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { checkBearer, isLoopback, localToken } from './auth.ts'
import type { Attempt } from './providers/cascade.ts'
import { config, setGroqApiKey } from './config.ts'
import { addTerm, deleteTerm, dictionaryTerms, importTerms, listDictionary, normalizeTerm, updateTerm } from './db.ts'
import { rebuildStyle, resetStyle, setStyleEnabled, StyleError, styleState } from './style.ts'
import { termsFromEdit } from './traits.ts'
import { defaultFolderId, listFolders, notionConfigured, NotionError, setDefaultFolderId, undoNote } from './integrations/notion.ts'
import {
  getProviderSettings,
  llmCascade,
  setProviderSettings,
  sttCascade,
  type ProviderSettings,
} from './providers/registry.ts'
import { startOfflineWatch } from './localAi.ts'
import { usageReport } from './usageReport.ts'
import { runVoiceFlow, VOICE_FLOW_MODES, VoiceFlowError, type VoiceFlowMode } from './voiceFlow.ts'

const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 })
await app.register(multipart, { limits: { fileSize: config.maxAudioBytes, files: 1, fields: 20 } })

const PUBLIC_ROUTES = new Set(['/health', '/auth/local-pair'])

app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
  if (!isLoopback(req.ip)) return reply.code(403).send({ error: { code: 'forbidden', message: 'só aceito pedidos locais' } })
  const path = req.url.split('?')[0]
  if (PUBLIC_ROUTES.has(path)) return
  if (!checkBearer(req.headers.authorization))
    return reply.code(401).send({ error: { code: 'unauthorized', message: 'token inválido' } })
})

/** " · falhas: groq:qwen/qwen3.8-27b (too_large)" — vazio quando tudo deu certo de primeira. */
function failedAttempts(attempts: Attempt[]): string {
  const failed = attempts.filter((a) => !a.ok)
  return failed.length ? ` · falhas: ${failed.map((a) => `${a.provider} (${a.failure ?? 'erro'})`).join(', ')}` : ''
}

const fail = (reply: FastifyReply, status: number, code: string, message: string, extra: object = {}) =>
  reply.code(status).send({ error: { code, message, ...extra } })

// ---------- saúde e token ----------

app.get('/health', async () => ({
  ok: true,
  version: '0.1.0',
  groq_configured: Boolean(config.groqApiKey),
}))

app.post('/auth/local-pair', async () => ({ token: localToken() }))

// Chave do Groq que o app guarda (D95). Só o app, com o token local, chega aqui.
app.post('/settings/groq-key', async (req, reply) => {
  const key = (req.body as { key?: unknown } | null)?.key
  if (key !== null && (typeof key !== 'string' || key.length > 200)) return fail(reply, 400, 'bad_request', 'key deve ser texto ou null')
  setGroqApiKey(key)
  return { groq_configured: Boolean(config.groqApiKey) }
})

// ---------- voz ----------

app.post('/ai/voice_flow', async (req, reply) => {
  const fields: Record<string, string> = {}
  let audio: Buffer | null = null
  let filename = 'audio.wav'
  let mimeType = 'audio/wav'
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'audio_file') {
          await part.toBuffer()
          continue
        }
        audio = await part.toBuffer()
        filename = part.filename || filename
        mimeType = part.mimetype || mimeType
      } else {
        fields[part.fieldname] = String(part.value ?? '')
      }
    }
  } catch (err) {
    return fail(reply, 400, 'bad_multipart', (err as Error).message)
  }

  const mode = (fields.mode || 'voice_transcript') as VoiceFlowMode
  if (!VOICE_FLOW_MODES.includes(mode)) return fail(reply, 400, 'bad_mode', `modo desconhecido: ${mode}`)
  if (!audio || audio.length === 0) return fail(reply, 400, 'no_audio', 'audio_file ausente')

  const parseJson = (v: string | undefined) => {
    if (!v) return {}
    try {
      return JSON.parse(v)
    } catch {
      return {}
    }
  }

  const started = Date.now()
  try {
    const out = await runVoiceFlow({
      audioId: fields.audio_id ?? '',
      mode,
      audio,
      filename,
      mimeType,
      audioContext: parseJson(fields.audio_context),
      parameters: parseJson(fields.parameters),
      isRetry: fields.is_retry === 'true',
    })
    console.log(
      `[voice_flow] ${fields.audio_id?.slice(0, 8) ?? '?'} ${mode}${fields.is_retry === 'true' ? ' (refazer)' : ''} ` +
        `stt=${out.debug.stt.provider} ${out.debug.stt.ms}ms · refino=${out.debug.refine.provider} ${out.debug.refine.ms}ms · ` +
        `${out.debug.ask ? `ação=${out.debug.ask.action}${out.debug.ask.search ? ` busca=${out.debug.ask.search.provider} ${out.debug.ask.search.ms}ms` : ''} · ` : ''}` +
        `total=${Date.now() - started}ms · ${out.refine_text.length} chars` +
        failedAttempts([...out.debug.stt.attempts, ...out.debug.refine.attempts, ...(out.debug.ask?.search?.attempts ?? [])]),
    )
    return { ...out, debug: out.debug }
  } catch (err) {
    if (err instanceof VoiceFlowError) {
      console.log(`[voice_flow] erro ${err.code}: ${err.message}`)
      return fail(reply, err.status, err.code, err.message, { attempts: err.attempts, ...err.details })
    }
    console.error('[voice_flow] erro inesperado', err)
    return fail(reply, 500, 'internal', 'erro interno no servidor')
  }
})

// ---------- dicionário ----------

app.route({ method: ['GET', 'POST'], url: '/user/dictionary/list', handler: async () => ({ items: listDictionary() }) })

app.post('/user/dictionary/add', async (req, reply) => {
  const term = normalizeTerm((req.body as { term?: unknown } | null)?.term)
  if (!term) return fail(reply, 400, 'bad_term', 'termo vazio ou longo demais')
  return { item: addTerm(term, 'manual') }
})

app.post('/user/dictionary/update', async (req, reply) => {
  const body = (req.body ?? {}) as { id?: unknown; term?: unknown }
  const term = normalizeTerm(body.term)
  if (typeof body.id !== 'string' || !term) return fail(reply, 400, 'bad_request', 'id e termo são obrigatórios')
  const item = updateTerm(body.id, term)
  if (!item) return fail(reply, 409, 'conflict', 'termo inexistente ou já cadastrado')
  return { item }
})

app.post('/user/dictionary/delete', async (req, reply) => {
  const id = (req.body as { id?: unknown } | null)?.id
  if (typeof id !== 'string') return fail(reply, 400, 'bad_request', 'id obrigatório')
  return { deleted: deleteTerm(id) }
})

app.post('/user/dictionary/import', async (req, reply) => {
  const terms = (req.body as { terms?: unknown } | null)?.terms
  if (!Array.isArray(terms)) return fail(reply, 400, 'bad_request', 'terms deve ser uma lista')
  return importTerms(terms)
})

// ---------- aprendizado por edição ----------

app.post('/user/traits', async (req, reply) => {
  const body = (req.body ?? {}) as { before?: unknown; after?: unknown }
  if (typeof body.before !== 'string' || typeof body.after !== 'string')
    return fail(reply, 400, 'bad_request', 'before e after são obrigatórios')
  if (body.before.length > 20_000 || body.after.length > 20_000) return { auto_add_dictionary: null, added: [] }
  const added = termsFromEdit(body.before, body.after, dictionaryTerms()).map((term) => addTerm(term, 'auto'))
  if (added.length) console.log(`[traits] ${added.length} termo(s) novo(s) no dicionário`)
  return {
    auto_add_dictionary: added[0] ? { term: added[0].term, user_dictionary_id: added[0].id } : null,
    added: added.map((e) => ({ term: e.term, user_dictionary_id: e.id })),
  }
})

// ---------- estilo pessoal ----------

app.get('/user/personal_stats', async () => styleState())

app.post('/user/update_settings', async (req) => {
  const on = (req.body as { personal_auto_style_on?: unknown } | null)?.personal_auto_style_on
  return typeof on === 'boolean' ? setStyleEnabled(on) : styleState()
})

app.post('/user/personal_style/rebuild', async (req, reply) => {
  const samples = (req.body as { samples?: unknown } | null)?.samples
  if (!Array.isArray(samples)) return fail(reply, 400, 'bad_request', 'samples deve ser uma lista')
  try {
    return await rebuildStyle(samples.slice(0, 200))
  } catch (err) {
    if (err instanceof StyleError) return fail(reply, err.code === 'unavailable' ? 503 : 400, err.code, err.message)
    throw err
  }
})

app.post('/user/personal_style/reset', async () => resetStyle())

// ---------- Notion (D72) ----------

async function notionView(force: boolean) {
  if (!notionConfigured()) return { configured: false, folders: [], default_folder_id: null, error: null }
  try {
    return { configured: true, folders: await listFolders(force), default_folder_id: defaultFolderId(), error: null }
  } catch (err) {
    const message = err instanceof NotionError ? err.message : 'erro inesperado'
    return { configured: true, folders: [], default_folder_id: defaultFolderId(), error: message }
  }
}

app.get('/integrations/notion', async () => notionView(false))
app.post('/integrations/notion/refresh', async () => notionView(true))

app.put('/integrations/notion/default', async (req) => {
  const id = (req.body as { id?: unknown } | null)?.id
  setDefaultFolderId(typeof id === 'string' && id ? id : null)
  return notionView(false)
})

app.post('/integrations/notion/undo', async (req, reply) => {
  const body = (req.body ?? {}) as { kind?: unknown; id?: unknown }
  if ((body.kind !== 'page' && body.kind !== 'block') || typeof body.id !== 'string')
    return fail(reply, 400, 'bad_request', 'kind e id são obrigatórios')
  try {
    await undoNote(body.kind, body.id)
    return { ok: true }
  } catch (err) {
    if (err instanceof NotionError) return fail(reply, 502, err.code, err.message)
    throw err
  }
})

// ---------- provedores (tela Modelos) ----------

const providersView = () => ({
  settings: getProviderSettings(),
  stt: sttCascade.status(),
  llm: llmCascade.status(),
})

app.get('/settings/providers', async () => providersView())

app.get('/usage', async () => usageReport())

app.put('/settings/providers', async (req) => {
  setProviderSettings(req.body as ProviderSettings)
  return providersView()
})

app.post('/settings/providers/unblock', async (req) => {
  const id = (req.body as { id?: unknown } | null)?.id
  if (typeof id === 'string') {
    sttCascade.clearBlock(id)
    llmCascade.clearBlock(id)
  }
  return providersView()
})

await app.listen({ host: config.host, port: config.port })
console.log(
  `[just-say-server] ouvindo em http://${config.host}:${config.port} · Groq ${config.groqApiKey ? 'configurado' : 'sem chave ainda (o app manda a da tela Chave do Groq)'}`,
)
// Reserva local (D94): liga o Whisper e o modelo de limpeza assim que a internet cai.
startOfflineWatch()
