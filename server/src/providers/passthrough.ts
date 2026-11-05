// Último degrau do refino: não chama modelo nenhum e devolve a transcrição como veio.
// Garante que o ditado nunca se perde, mesmo com todos os limites gratuitos esgotados.
import type { LlmProvider, LlmRequest } from './types.ts'

export class PassthroughLlm implements LlmProvider {
  readonly id = 'none'
  readonly label = 'Sem refino (transcrição pura)'
  readonly free = true
  readonly passthrough = true

  isConfigured(): boolean {
    return true
  }

  async complete(req: LlmRequest): Promise<string> {
    return req.fallbackText
  }
}
