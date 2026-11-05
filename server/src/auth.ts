// Token local de um único usuário. Sem OAuth (fora do escopo).
// O app pede o token em POST /auth/local-pair, que só responde a pedidos do próprio PC.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.ts'

const tokenFile = join(config.dataDir, 'auth.json')

function loadOrCreateToken(): string {
  if (existsSync(tokenFile)) {
    try {
      const saved = JSON.parse(readFileSync(tokenFile, 'utf8')) as { token?: string }
      if (saved.token && saved.token.length >= 32) return saved.token
    } catch {
      // arquivo corrompido: gera outro
    }
  }
  const token = randomBytes(32).toString('base64url')
  writeFileSync(tokenFile, JSON.stringify({ token, created_at: new Date().toISOString() }, null, 2))
  return token
}

const token = loadOrCreateToken()

export function localToken(): string {
  return token
}

export function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

export function checkBearer(header: string | undefined): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice(7).trim())
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
