// Cascata de provedores: tenta na ordem configurada e pula os que estão esgotados.
// - Limite do plano gratuito (429): o provedor fica "esgotado até" o horário que ele informou.
// - Fora do ar / erro: fica de lado por um tempo curto (cooldown).
// - Tempo do pedido acabando: para de tentar.
import { config } from '../config.ts'
import {
  isAbort,
  ProviderLimitError,
  ProviderNetworkError,
  ProviderRequestTooLargeError,
  ProviderUnavailableError,
  type ProviderInfo,
} from './types.ts'

export interface ProviderSetting {
  id: string
  enabled: boolean
}

export interface ProviderStatus {
  id: string
  label: string
  free: boolean
  enabled: boolean
  configured: boolean
  /** Epoch ms até quando está esgotado/fora; null = disponível. */
  blockedUntil: number | null
  blockReason: 'limit' | 'unavailable' | null
  lastError: string | null
  lastUsedAt: number | null
}

export interface Attempt {
  provider: string
  ok: boolean
  ms: number
  error?: string
  /** Por que falhou: limite gratuito, sem internet, fora do ar, demorou ou outro erro. */
  failure?: 'limit' | 'network' | 'unavailable' | 'too_large' | 'timeout' | 'error'
  /** No limite: em quanto tempo o provedor volta (separa "por minuto" de "do dia", D92). */
  retryAfterMs?: number
}

/** Todas as tentativas falharam por falta de rede (nenhuma chegou a um provedor). */
export function allNetworkFailures(attempts: Attempt[]): boolean {
  const failed = attempts.filter((a) => !a.ok)
  return failed.length > 0 && failed.every((a) => a.failure === 'network')
}

export class AllProvidersFailedError extends Error {
  constructor(readonly attempts: Attempt[]) {
    super(
      attempts.length
        ? `nenhum provedor respondeu: ${attempts.map((a) => `${a.provider} (${a.error})`).join('; ')}`
        : 'nenhum provedor disponível',
    )
  }
}

interface RuntimeState {
  blockedUntil: number | null
  blockReason: 'limit' | 'unavailable' | null
  lastError: string | null
  lastUsedAt: number | null
}

/** Ordena os provedores pela configuração salva; os que não estão nela vão para o fim. */
export function applySettings<P extends ProviderInfo>(providers: P[], settings: ProviderSetting[]): { provider: P; enabled: boolean }[] {
  const byId = new Map(providers.map((p) => [p.id, p]))
  const out: { provider: P; enabled: boolean }[] = []
  for (const s of settings) {
    const p = byId.get(s.id)
    if (p) {
      out.push({ provider: p, enabled: s.enabled })
      byId.delete(s.id)
    }
  }
  for (const p of byId.values()) out.push({ provider: p, enabled: false })
  return out
}

export class Cascade<P extends ProviderInfo> {
  private readonly state = new Map<string, RuntimeState>()

  constructor(
    private readonly providers: P[],
    private readonly getSettings: () => ProviderSetting[],
    private readonly now: () => number = () => Date.now(),
  ) {}

  private runtime(id: string): RuntimeState {
    let s = this.state.get(id)
    if (!s) {
      s = { blockedUntil: null, blockReason: null, lastError: null, lastUsedAt: null }
      this.state.set(id, s)
    }
    return s
  }

  status(): ProviderStatus[] {
    const now = this.now()
    return applySettings(this.providers, this.getSettings()).map(({ provider, enabled }) => {
      const s = this.runtime(provider.id)
      const blocked = s.blockedUntil !== null && s.blockedUntil > now
      return {
        id: provider.id,
        label: provider.label,
        free: provider.free,
        enabled,
        configured: provider.isConfigured(),
        blockedUntil: blocked ? s.blockedUntil : null,
        blockReason: blocked ? s.blockReason : null,
        lastError: s.lastError,
        lastUsedAt: s.lastUsedAt,
      }
    })
  }

  /** Libera um provedor marcado como esgotado/fora (botão "tentar de novo" na tela). */
  clearBlock(id: string): void {
    const s = this.runtime(id)
    s.blockedUntil = null
    s.blockReason = null
  }

  /**
   * Roda `fn` no primeiro provedor disponível. `deadline` = epoch ms em que o pedido inteiro
   * precisa terminar; cada tentativa recebe no máximo o tempo que resta.
   */
  async run<T>(
    fn: (provider: P, signal: AbortSignal) => Promise<T>,
    opts: { deadline: number; perProviderTimeoutMs: number; skip?: (provider: P) => boolean },
  ): Promise<{ provider: P; value: T; attempts: Attempt[] }> {
    const attempts: Attempt[] = []
    for (const { provider, enabled } of applySettings(this.providers, this.getSettings())) {
      if (!enabled || !provider.isConfigured() || opts.skip?.(provider)) continue
      const s = this.runtime(provider.id)
      const now = this.now()
      if (s.blockedUntil !== null && s.blockedUntil > now) continue
      const remaining = opts.deadline - now
      if (remaining < 300) break

      const t0 = this.now()
      try {
        const value = await fn(provider, AbortSignal.timeout(Math.min(opts.perProviderTimeoutMs, remaining)))
        s.lastUsedAt = this.now()
        s.blockedUntil = null
        s.blockReason = null
        attempts.push({ provider: provider.id, ok: true, ms: this.now() - t0 })
        return { provider, value, attempts }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const failure: Attempt['failure'] =
          err instanceof ProviderLimitError
            ? 'limit'
            : err instanceof ProviderNetworkError
              ? 'network'
              : err instanceof ProviderUnavailableError
              ? 'unavailable'
              : err instanceof ProviderRequestTooLargeError
                ? 'too_large'
                : isAbort(err)
                  ? 'timeout'
                  : 'error'
        attempts.push({
          provider: provider.id,
          ok: false,
          ms: this.now() - t0,
          error: message,
          failure,
          ...(err instanceof ProviderLimitError ? { retryAfterMs: err.retryAfterMs } : {}),
        })
        s.lastError = message
        if (err instanceof ProviderRequestTooLargeError) {
          // Só este pedido era grande demais: não bloqueia o provedor para os próximos.
        } else if (err instanceof ProviderNetworkError) {
          // Sem internet: o provedor não tem culpa. Sem bloqueio, o próximo pedido já tenta
          // de novo assim que a conexão voltar.
        } else if (err instanceof ProviderLimitError) {
          s.blockedUntil = this.now() + err.retryAfterMs
          s.blockReason = 'limit'
        } else if (err instanceof ProviderUnavailableError) {
          s.blockedUntil = this.now() + config.unavailableCooldownMs
          s.blockReason = 'unavailable'
        } else if (!isAbort(err)) {
          // Erro inesperado (resposta malformada etc.): trata como indisponível.
          s.blockedUntil = this.now() + config.unavailableCooldownMs
          s.blockReason = 'unavailable'
        }
        // Timeout: não bloqueia (pode ter sido só este pedido), mas passa para o próximo.
      }
    }
    throw new AllProvidersFailedError(attempts)
  }
}
