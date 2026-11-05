// Chave do Groq de cada pessoa (D95): digitada na tela "Chave do Groq", guardada criptografada
// pelo Windows (safeStorage, DPAPI da conta do usuário) em userData/api-keys.json, e entregue ao
// servidor local a cada vez que ele sobe. A chave nunca vai para log nem para o renderer.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { postServerJson, serverBaseUrl } from './server/client'

interface Stored {
  groq?: string // base64 do texto criptografado
}

const file = () => join(app.getPath('userData'), 'api-keys.json')

function read(): Stored {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as Stored) : {}
  } catch {
    return {}
  }
}

function groqKey(): string | null {
  const enc = read().groq
  if (!enc || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export interface GroqKeyStatus {
  /** Há uma chave guardada no app. */
  saved: boolean
  /** Últimos 4 caracteres, para a pessoa reconhecer qual é. */
  last4: string | null
  /** O servidor está com alguma chave (a do app ou a do server/.env). */
  serverConfigured: boolean
}

export async function groqKeyStatus(): Promise<GroqKeyStatus> {
  const key = groqKey()
  let serverConfigured = false
  try {
    const res = await fetch(`${serverBaseUrl()}/health`, { signal: AbortSignal.timeout(1500) })
    serverConfigured = Boolean(((await res.json()) as { groq_configured?: boolean }).groq_configured)
  } catch {
    // servidor fora do ar
  }
  return { saved: key !== null, last4: key ? key.slice(-4) : null, serverConfigured }
}

/** Confere a chave direto no Groq (lista de modelos): não gasta nada do limite de ditados. */
export async function testGroqKey(key: string): Promise<{ ok: boolean; message: string }> {
  const k = key.trim()
  if (!/^gsk_[A-Za-z0-9]{20,}$/.test(k)) return { ok: false, message: 'Isso não parece uma chave do Groq (começa com "gsk_").' }
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${k}` },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) return { ok: true, message: 'Chave válida.' }
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'O Groq recusou essa chave. Confira se copiou inteira.' }
    return { ok: false, message: `O Groq respondeu com erro ${res.status}. Tente de novo daqui a pouco.` }
  } catch {
    return { ok: false, message: 'Sem conexão com o Groq. Confira a internet.' }
  }
}

/** Manda a chave guardada (ou a remoção) para o servidor local. */
export async function pushGroqKeyToServer(removed = false): Promise<void> {
  const key = groqKey()
  if (!key && !removed) return // sem chave no app: o servidor segue com a do server/.env, se houver
  await postServerJson('/settings/groq-key', { key: removed ? null : key }).catch(() => {})
}

/** Testa, guarda criptografada e entrega ao servidor. */
export async function saveGroqKey(key: string): Promise<{ ok: boolean; message: string }> {
  const test = await testGroqKey(key)
  if (!test.ok) return test
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, message: 'O Windows não liberou a criptografia para guardar a chave.' }
  const stored = read()
  stored.groq = safeStorage.encryptString(key.trim()).toString('base64')
  writeFileSync(file(), JSON.stringify(stored))
  await pushGroqKeyToServer()
  return { ok: true, message: 'Chave guardada. O Just Say já pode ditar.' }
}

export async function removeGroqKey(): Promise<void> {
  const stored = read()
  delete stored.groq
  writeFileSync(file(), JSON.stringify(stored))
  await pushGroqKeyToServer(true)
}
