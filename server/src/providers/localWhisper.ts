// Whisper rodando no próprio PC (local-whisper/server.py, faster-whisper na GPU).
// Reserva do Groq: o servidor liga o processo sozinho quando precisa (localAi.ts, D94).
import { config } from '../config.ts'
import { ensureLocal, localInstalled } from '../localAi.ts'
import { isAbort, ProviderUnavailableError, type SttProvider, type SttRequest, type SttResult } from './types.ts'

export class LocalWhisperStt implements SttProvider {
  readonly id = 'local:whisper'
  readonly label = 'Whisper local (sua GPU)'
  readonly free = true

  isConfigured(): boolean {
    return localInstalled('whisper')
  }

  async transcribe(req: SttRequest): Promise<SttResult> {
    await ensureLocal('whisper', req.signal)
    const url = new URL(`${config.localWhisperUrl}/transcribe`)
    if (req.language) url.searchParams.set('language', req.language)
    if (req.prompt) url.searchParams.set('prompt', req.prompt)
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': req.mimeType },
        body: new Uint8Array(req.audio),
        signal: req.signal,
      })
    } catch (err) {
      if (isAbort(err)) throw err
      throw new ProviderUnavailableError(`${this.label}: não está rodando em ${config.localWhisperUrl}`)
    }
    if (!res.ok) throw new ProviderUnavailableError(`${this.label}: erro ${res.status}`)
    const json = (await res.json()) as { text?: string; language?: string }
    return { text: (json.text ?? '').trim(), language: json.language }
  }
}
