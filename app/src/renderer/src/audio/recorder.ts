// Gravador: microfone → AudioContext 16 kHz → worklet → blocos PCM16.
// `getUserMedia` com eco, ruído e ganho automático desligados.
// Começa no keydown; `ready()` é uma das checagens que rodam em paralelo.
//
// Microfone aquecido (D93): um fone sem fio pode levar de 0,4 a 2 s para mandar som depois
// de aberto; até lá só chegam zeros, e a fala desse começo se perdia. Por isso:
//  - o microfone fica aberto por WARM_MS depois de cada gravação, e o próximo ditado começa
//    na hora (os blocos que chegam sem gravação em andamento são descartados, nada é guardado);
//  - `onLive` avisa quando chega o primeiro som de verdade (amostra diferente de zero): é a
//    hora do som de início. Os zeros do começo não contam para a detecção de "nenhuma fala".
import { AUDIO } from '../../../shared/constants'
import { CAPTURE_PROCESSOR, captureWorkletUrl } from './worklet'
import { SilenceDetector } from './silence'
import { concatPcm16, floatToPcm16, pcmDurationMs } from './wav'

export interface RecordedAudio {
  sessionId: string
  pcm: Int16Array
  durationMs: number
  /** Do toque até a primeira amostra com som chegar. */
  firstSampleLatencyMs: number | null
}

export interface RecorderEvents {
  onNoSpeech: (sessionId: string) => void
  /** O microfone mandou o primeiro som de verdade nesta gravação. */
  onLive?: (sessionId: string) => void
}

export class MicrophoneError extends Error {
  readonly code = 'INIT_CHECK_FAILED'
  readonly recoverable = false
}

/** Microfone aberto: dura entre gravações enquanto estiver aquecido. */
interface Pipeline {
  deviceId: string | null
  stream: MediaStream | null
  ctx: AudioContext | null
  node: AudioWorkletNode | null
  opened: Promise<void>
  closed: boolean
  /** Já chegou alguma amostra diferente de zero desde que abriu. */
  live: boolean
}

interface Session {
  id: string
  startedAt: number
  stopped: boolean
  blocks: Int16Array[]
  samples: number
  firstSampleAt: number | null
  live: boolean
  silence: SilenceDetector
  pipeline: Pipeline
}

const FLUSH_TIMEOUT_MS = 150
/** Quanto tempo o microfone fica aberto depois da última gravação. */
const WARM_MS = 10 * 60_000

export class AudioRecorder {
  private session: Session | null = null
  private pipeline: Pipeline | null = null
  private coolTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly events: RecorderEvents) {}

  get activeSessionId(): string | null {
    return this.session && !this.session.stopped ? this.session.id : null
  }

  /** Começa a gravar. Chamar de novo com a mesma sessão não faz nada. */
  start(sessionId: string, deviceId: string | null, startedAt: number): void {
    if (this.session && !this.session.stopped) {
      if (this.session.id === sessionId) return
      this.discard()
    }
    if (this.coolTimer) clearTimeout(this.coolTimer)
    this.coolTimer = null
    const pipeline = this.pipelineFor(deviceId)
    const session: Session = {
      id: sessionId,
      startedAt,
      stopped: false,
      blocks: [],
      samples: 0,
      firstSampleAt: null,
      live: false,
      silence: new SilenceDetector(),
      pipeline,
    }
    this.session = session
    // Microfone já aquecido e mandando som: avisa na hora.
    if (pipeline.live) this.markLive(session, startedAt)
  }

  /** Resolve quando o microfone abriu; rejeita com MicrophoneError. */
  ready(sessionId: string): Promise<void> {
    if (!this.session || this.session.id !== sessionId) return Promise.reject(new MicrophoneError('Sessão de gravação perdida.'))
    return this.session.pipeline.opened
  }

  /** Para e devolve o áudio. O microfone continua aquecido. */
  async stop(sessionId: string): Promise<RecordedAudio> {
    const session = this.session
    if (!session || session.id !== sessionId) throw new MicrophoneError('Nenhuma gravação em andamento.')
    try {
      await session.pipeline.opened
    } catch (err) {
      this.endSession(session)
      this.closePipeline(session.pipeline)
      throw err
    }
    await this.flush(session.pipeline)
    this.endSession(session)
    const pcm = concatPcm16(session.blocks)
    return {
      sessionId,
      pcm,
      durationMs: pcmDurationMs(pcm.length, AUDIO.SAMPLE_RATE),
      firstSampleLatencyMs: session.firstSampleAt === null ? null : session.firstSampleAt - session.startedAt,
    }
  }

  /** Para e joga fora a gravação. O microfone continua aquecido. */
  discard(): void {
    if (this.session) this.endSession(this.session)
  }

  /** Fecha o microfone agora (troca de aparelho, app fechando). */
  cool(): void {
    this.discard()
    if (this.coolTimer) clearTimeout(this.coolTimer)
    this.coolTimer = null
    if (this.pipeline) this.closePipeline(this.pipeline)
  }

  private endSession(session: Session): void {
    session.stopped = true
    if (this.session === session) this.session = null
    if (this.coolTimer) clearTimeout(this.coolTimer)
    this.coolTimer = setTimeout(() => this.cool(), WARM_MS)
  }

  /** O microfone aberto para este aparelho, aquecido ou novo. */
  private pipelineFor(deviceId: string | null): Pipeline {
    const p = this.pipeline
    const tracksOk = p?.stream ? p.stream.getAudioTracks().every((t) => t.readyState === 'live') : true
    if (p && !p.closed && p.deviceId === deviceId && tracksOk) return p
    if (p) this.closePipeline(p)
    const pipeline: Pipeline = { deviceId, stream: null, ctx: null, node: null, opened: Promise.resolve(), closed: false, live: false }
    pipeline.opened = this.open(pipeline)
    pipeline.opened.catch(() => this.closePipeline(pipeline)) // quem precisa do erro chama ready()
    this.pipeline = pipeline
    return pipeline
  }

  private async open(pipeline: Pipeline): Promise<void> {
    const constraints = (id: string | null): MediaStreamConstraints => ({
      audio: {
        ...(id ? { deviceId: { exact: id } } : {}),
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints(pipeline.deviceId))
    } catch (err) {
      // O microfone escolhido sumiu: cai para o padrão do sistema.
      if (!pipeline.deviceId) throw toMicError(err)
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints(null))
      } catch (err2) {
        throw toMicError(err2)
      }
    }
    if (pipeline.closed) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    pipeline.stream = stream
    const ctx = new AudioContext({ sampleRate: AUDIO.SAMPLE_RATE, latencyHint: 'interactive' })
    pipeline.ctx = ctx
    await ctx.audioWorklet.addModule(captureWorkletUrl())
    if (pipeline.closed) return
    const source = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, CAPTURE_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    })
    node.port.onmessage = (e: MessageEvent) => {
      if (e.data instanceof Float32Array) this.onBlock(pipeline, e.data)
    }
    source.connect(node)
    node.connect(ctx.destination) // o worklet não escreve na saída: só mantém o grafo ativo
    pipeline.node = node
    if (ctx.state === 'suspended') await ctx.resume()
  }

  private onBlock(pipeline: Pipeline, block: Float32Array): void {
    if (!pipeline.live && block.some((v) => v !== 0)) pipeline.live = true
    const session = this.session
    // Sem gravação em andamento (microfone só aquecido): descarta.
    if (!session || session.stopped || session.pipeline !== pipeline) return
    if (!session.live && pipeline.live) this.markLive(session, performance.timeOrigin + performance.now())
    session.blocks.push(floatToPcm16(block))
    session.samples += block.length
    // Os zeros de antes do microfone acordar não contam como silêncio de quem não falou.
    if (!session.live) return
    const before = session.silence.result
    if (session.silence.feed(block) === 'no_speech' && before === 'pending') this.events.onNoSpeech(session.id)
  }

  private markLive(session: Session, at: number): void {
    session.live = true
    session.firstSampleAt = at
    this.events.onLive?.(session.id)
  }

  private flush(pipeline: Pipeline): Promise<void> {
    const node = pipeline.node
    if (!node) return Promise.resolve()
    return new Promise((resolve) => {
      const previous = node.port.onmessage
      const done = () => {
        clearTimeout(timer)
        node.port.onmessage = previous // o microfone segue aquecido com o mesmo tratador
        resolve()
      }
      const timer = setTimeout(done, FLUSH_TIMEOUT_MS)
      node.port.onmessage = (e: MessageEvent) => {
        if (e.data === 'flushed') done()
        else previous?.call(node.port, e)
      }
      node.port.postMessage('flush')
    })
  }

  private closePipeline(pipeline: Pipeline): void {
    pipeline.closed = true
    pipeline.node?.disconnect()
    pipeline.stream?.getTracks().forEach((t) => t.stop())
    void pipeline.ctx?.close().catch(() => {})
    pipeline.node = null
    pipeline.stream = null
    pipeline.ctx = null
    if (this.pipeline === pipeline) this.pipeline = null
  }
}

function toMicError(err: unknown): MicrophoneError {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError')
    return new MicrophoneError('O Windows bloqueou o microfone. Libere em Configurações → Privacidade → Microfone.')
  if (name === 'NotFoundError') return new MicrophoneError('Nenhum microfone encontrado.')
  return new MicrophoneError(`Não consegui abrir o microfone (${name || String(err)}).`)
}
