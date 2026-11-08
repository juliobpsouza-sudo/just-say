// Provedores disponíveis, ordem padrão e a configuração salva (data/providers.json).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../config.ts'
import { setLocalPrimary } from '../localAi.ts'
import { Cascade, type ProviderSetting } from './cascade.ts'
import { GroqLlm, GroqSearch, GroqStt } from './groq.ts'
import { LocalLlm } from './localLlm.ts'
import { LocalWhisperStt } from './localWhisper.ts'
import { PassthroughLlm } from './passthrough.ts'
import type { LlmProvider, SearchProvider, SttProvider } from './types.ts'

// Ordem do refino escolhida por teste em pt-BR (ver DECISOES D33): o Qwen foi o mais fiel
// à fala e o mais rápido; o gpt-oss-120b limpa bem mas formaliza; o 20b errou autocorreções.
const sttProviders: SttProvider[] = [
  new GroqStt('whisper-large-v3-turbo'),
  new GroqStt('whisper-large-v3'),
  new LocalWhisperStt(),
]

const llmProviders: LlmProvider[] = [
  new GroqLlm('qwen/qwen3.8-27b', { reasoning_effort: 'none', reasoning_format: 'hidden' }),
  new GroqLlm('openai/gpt-oss-120b', { reasoning_effort: 'low', include_reasoning: false }),
  new GroqLlm('openai/gpt-oss-20b', { reasoning_effort: 'low', include_reasoning: false }),
  new LocalLlm(),
  new PassthroughLlm(),
]

export interface ProviderSettings {
  stt: ProviderSetting[]
  llm: ProviderSetting[]
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  stt: [
    { id: 'groq:whisper-large-v3-turbo', enabled: true },
    { id: 'groq:whisper-large-v3', enabled: true },
    { id: 'local:whisper', enabled: true },
  ],
  llm: [
    { id: 'groq:qwen/qwen3.8-27b', enabled: true },
    { id: 'groq:openai/gpt-oss-120b', enabled: true },
    { id: 'groq:openai/gpt-oss-20b', enabled: true },
    { id: 'local:llm', enabled: true },
    { id: 'none', enabled: true },
  ],
}

const settingsFile = join(config.dataDir, 'providers.json')

function load(): ProviderSettings {
  if (!existsSync(settingsFile)) return structuredClone(DEFAULT_PROVIDER_SETTINGS)
  try {
    const saved = JSON.parse(readFileSync(settingsFile, 'utf8')) as Partial<ProviderSettings>
    const llm = Array.isArray(saved.llm) ? saved.llm : structuredClone(DEFAULT_PROVIDER_SETTINGS.llm)
    // Configuração de antes do modelo local (D94): ele entra ligado, logo antes do "sem refino".
    if (!llm.some((s) => s.id === 'local:llm')) {
      const none = llm.findIndex((s) => s.id === 'none')
      llm.splice(none < 0 ? llm.length : none, 0, { id: 'local:llm', enabled: true })
    }
    return { stt: Array.isArray(saved.stt) ? saved.stt : DEFAULT_PROVIDER_SETTINGS.stt, llm }
  } catch {
    return structuredClone(DEFAULT_PROVIDER_SETTINGS)
  }
}

let settings = load()

/** A placa é a 1ª opção ligada? Então fica sempre pronta (D94). */
function applyLocalPrimary(): void {
  const first = (list: ProviderSetting[]) => list.find((s) => s.enabled)?.id
  setLocalPrimary({ whisper: first(settings.stt) === 'local:whisper', llm: first(settings.llm) === 'local:llm' })
}
applyLocalPrimary()

export function getProviderSettings(): ProviderSettings {
  return settings
}

/** Salva a ordem e o liga/desliga. Ids desconhecidos são descartados. */
export function setProviderSettings(next: ProviderSettings): ProviderSettings {
  const clean = (list: ProviderSetting[], known: { id: string }[]) =>
    list
      .filter((s) => known.some((p) => p.id === s.id))
      .map((s) => ({ id: String(s.id), enabled: Boolean(s.enabled) }))
  settings = { stt: clean(next.stt ?? [], sttProviders), llm: clean(next.llm ?? [], llmProviders) }
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
  applyLocalPrimary()
  return settings
}

export const sttCascade = new Cascade<SttProvider>(sttProviders, () => settings.stt)

export function sttProviderList(): readonly SttProvider[] {
  return sttProviders
}

export function llmProviderList(): readonly LlmProvider[] {
  return llmProviders
}

export function providerLabel(id: string): string {
  return [...sttProviders, ...llmProviders].find((p) => p.id === id)?.label ?? id
}

export const llmCascade = new Cascade<LlmProvider>(llmProviders, () => settings.llm)

// Busca na web do Just Ask: só os gpt-oss têm a ferramenta no Groq. Ordem fixa: o 20b
// respondeu em ~3 s no teste e é o mais leve; o 120b fica de reserva (D54).
const searchProviders: SearchProvider[] = [new GroqSearch('openai/gpt-oss-20b'), new GroqSearch('openai/gpt-oss-120b')]
const searchSettings = searchProviders.map((p) => ({ id: p.id, enabled: true }))

export const searchCascade = new Cascade<SearchProvider>(searchProviders, () => searchSettings)
