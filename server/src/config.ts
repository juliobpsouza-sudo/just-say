// Configuração do servidor. As chaves vêm do .env (fora do git), nunca do código.
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const envFile = join(ROOT, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const dataDir = join(ROOT, 'data')
mkdirSync(dataDir, { recursive: true })

export const config = {
  /** Só loopback: o servidor nunca fica exposto na rede. */
  host: '127.0.0.1',
  port: Number(process.env.JUST_SAY_PORT ?? 8787),
  dataDir,
  groqApiKey: process.env.GROQ_API_KEY?.trim() || null,
  /** Integração com o Notion (opcional, D72). */
  notionToken: process.env.NOTION_TOKEN?.trim() || null,
  localWhisperUrl: (process.env.LOCAL_WHISPER_URL ?? 'http://127.0.0.1:8788').replace(/\/$/, ''),
  /** llama.cpp com o modelo de limpeza local (D94). */
  localLlmUrl: (process.env.LOCAL_LLM_URL ?? 'http://127.0.0.1:8790').replace(/\/$/, ''),

  /** Prazo total do pedido: fica abaixo dos 20 s de refino do cliente. */
  voiceFlowDeadlineMs: 18_000,
  sttTimeoutMs: 15_000,
  llmTimeoutMs: 8_000,
  /** Ask Anything: o cliente espera até 30 s; a resposta pode ser longa e ter busca. */
  askDeadlineMs: 28_000,
  askLlmTimeoutMs: 15_000,
  searchTimeoutMs: 15_000,
  /** Um provedor fora do ar fica de lado por este tempo antes de ser tentado de novo. */
  unavailableCooldownMs: 30_000,
  maxAudioBytes: 60 * 1024 * 1024,
} as const

/**
 * Chave do Groq vinda do app (tela "Chave do Groq", D95): cada pessoa usa a própria chave, que o
 * app guarda criptografada e manda para cá ao subir. O `server/.env` continua valendo para quem
 * prefere o arquivo; a chave do app tem prioridade. null volta para a do `.env`.
 */
const envGroqKey = config.groqApiKey
export function setGroqApiKey(key: string | null): void {
  ;(config as { groqApiKey: string | null }).groqApiKey = key?.trim() || envGroqKey
}
