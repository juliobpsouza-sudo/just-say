// Limpeza do ditado na placa de vídeo (llama.cpp + Qwen3.5), reserva do Groq (D94).
// Só para o ditado: o Ask Anything, a tradução e o estilo pessoal pulam este provedor.
// O servidor liga o llama.cpp sozinho quando precisa (localAi.ts).
import { config } from '../config.ts'
import { ensureLocal, localInstalled } from '../localAi.ts'
import { isAbort, ProviderUnavailableError, type LlmProvider, type LlmRequest } from './types.ts'

export class LocalLlm implements LlmProvider {
  readonly id = 'local:llm'
  readonly label = 'Modelo local (sua GPU)'
  readonly free = true
  readonly local = true

  isConfigured(): boolean {
    return localInstalled('llm')
  }

  async complete(req: LlmRequest): Promise<string> {
    await ensureLocal('llm', req.signal)
    let res: Response
    try {
      res = await fetch(`${config.localLlmUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: req.signal,
        body: JSON.stringify({
          temperature: 0.2,
          max_tokens: req.maxTokens,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          // O Qwen3.5 "pensa" antes de responder por padrão: aqui só atrasaria.
          chat_template_kwargs: { enable_thinking: false },
        }),
      })
    } catch (err) {
      if (isAbort(err)) throw err
      throw new ProviderUnavailableError(`${this.label}: não respondeu`)
    }
    if (!res.ok) throw new ProviderUnavailableError(`${this.label}: erro ${res.status}`)
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return json.choices?.[0]?.message?.content ?? ''
  }
}
