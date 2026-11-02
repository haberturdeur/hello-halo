import type { AgentOptions, ModelListItem, Run, SDKAgent } from '@cursor/sdk'
import { CursorEventNormalizer } from './event-normalizer'
import { prepareCursorOptions } from './options'

export interface CursorSdkRuntime {
  Agent: {
    create(options: AgentOptions): Promise<SDKAgent>
    resume(agentId: string, options?: Partial<AgentOptions>): Promise<SDKAgent>
  }
  Cursor?: {
    models: {
      list(options?: { apiKey?: string }): Promise<ModelListItem[]>
    }
  }
}

interface QueuedMessage {
  value: string | { text: string; images?: Array<{ data: string; mimeType: string }> }
}

export class CursorSession {
  private readonly queue: QueuedMessage[] = []
  private readonly queueWaiters: Array<() => void> = []
  private readonly exitListeners = new Set<(error?: Error) => void>()
  private currentRun: Run | null = null
  private closed = false
  private disposed = false
  private closePromise: Promise<void> | null = null
  private initialContext: string

  readonly query: {
    transport: {
      isReady: () => boolean
      ready: boolean
      onExit: (cb: (error?: Error) => void) => () => void
    }
    supportedCommands: () => Promise<unknown[]>
  }

  private constructor(
    private readonly agent: SDKAgent,
    private readonly model: string,
    private readonly includePartialMessages: boolean,
    private readonly mcpServerNames: string[],
    initialContext: string,
  ) {
    this.initialContext = initialContext
    const isReady = (): boolean => !this.closed
    this.query = {
      transport: {
        isReady,
        get ready() { return isReady() },
        onExit: (cb) => {
          this.exitListeners.add(cb)
          return () => this.exitListeners.delete(cb)
        },
      },
      supportedCommands: async () => [],
    }
  }

  static async create(
    sdk: CursorSdkRuntime,
    sdkOptions: Record<string, any>,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<CursorSession> {
    const prepared = await prepareCursorOptions(sdkOptions, env)
    const resumeId = typeof sdkOptions.resume === 'string' && sdkOptions.resume
      ? sdkOptions.resume
      : null
    const agent = resumeId
      ? await sdk.Agent.resume(resumeId, prepared.agentOptions)
      : await sdk.Agent.create(prepared.agentOptions)
    return new CursorSession(
      agent,
      prepared.agentOptions.model?.id ?? 'auto',
      prepared.includePartialMessages,
      prepared.mcpServerNames,
      resumeId ? '' : prepared.initialContext,
    )
  }

  get sessionId(): string {
    return this.agent.agentId
  }

  send(message: any): void {
    if (this.closed) throw new Error('Cursor session is closed')
    this.queue.push({ value: toCursorMessage(message) })
    this.wakeQueueWaiters()
  }

  hasPendingInput(): boolean {
    return !this.closed && (this.queue.length > 0 || this.currentRun !== null)
  }

  async withdrawUnreadInput(): Promise<number> {
    const count = this.queue.length
    this.queue.splice(0)
    return count
  }

  async *stream(): AsyncIterable<any> {
    const queued = await this.nextMessage()
    if (!queued) return

    const normalizer = new CursorEventNormalizer({
      sessionId: this.sessionId,
      model: this.model,
      includePartialMessages: this.includePartialMessages,
      mcpServerNames: this.mcpServerNames,
    })
    for (const frame of normalizer.beginTurn()) yield frame

    let terminal: Record<string, any>
    try {
      const run = await this.agent.send(this.withInitialContext(queued.value))
      this.currentRun = run
      for await (const message of run.stream()) {
        for (const frame of normalizer.handle(message)) yield frame
      }
      terminal = await run.wait()
    } catch (error) {
      terminal = {
        id: this.currentRun?.id ?? 'cursor-run',
        status: 'error',
        error: { message: error instanceof Error ? error.message : String(error) },
      }
    } finally {
      this.currentRun = null
    }

    for (const frame of normalizer.endTurn(terminal)) yield frame
  }

  async interrupt(): Promise<void> {
    const run = this.currentRun
    if (!run || !run.supports('cancel')) return
    try {
      await run.cancel()
    } catch (error) {
      console.warn(`[Cursor][session] run cancel failed: ${(error as Error).message}`)
    }
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    if (this.disposed) return
    this.closed = true
    this.queue.splice(0)
    this.wakeQueueWaiters()
    this.closePromise = (async () => {
      await this.interrupt()
      this.disposed = true
      await this.agent[Symbol.asyncDispose]()
      for (const listener of Array.from(this.exitListeners)) {
        try { listener() } catch { /* best effort */ }
      }
    })()
    return this.closePromise
  }

  async flush(): Promise<void> {
    await this.close()
  }

  async setMaxThinkingTokens(_maxThinkingTokens: number | null): Promise<void> {}

  async setPermissionMode(
    _mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan',
  ): Promise<void> {}

  private async nextMessage(): Promise<QueuedMessage | null> {
    while (!this.closed && this.queue.length === 0) {
      await new Promise<void>(resolve => this.queueWaiters.push(resolve))
    }
    return this.queue.shift() ?? null
  }

  private wakeQueueWaiters(): void {
    for (const waiter of this.queueWaiters.splice(0)) waiter()
  }

  private withInitialContext(message: QueuedMessage['value']): QueuedMessage['value'] {
    const context = this.initialContext.trim()
    this.initialContext = ''
    if (!context) return message
    const prefix = `<halo_context>\n${context}\n</halo_context>\n\n`
    return typeof message === 'string'
      ? `${prefix}${message}`
      : { ...message, text: `${prefix}${message.text}` }
  }
}

function toCursorMessage(
  message: any,
): string | { text: string; images?: Array<{ data: string; mimeType: string }> } {
  if (typeof message === 'string') return message
  const content = message?.message?.content ?? message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(message)

  const text: string[] = []
  const images: Array<{ data: string; mimeType: string }> = []
  for (const block of content) {
    if (block?.type === 'text') text.push(String(block.text ?? ''))
    if (block?.type === 'image' && block.source?.type === 'base64') {
      images.push({
        data: String(block.source.data ?? ''),
        mimeType: String(block.source.media_type ?? 'image/png'),
      })
    }
  }
  return images.length > 0 ? { text: text.join('\n\n'), images } : text.join('\n\n')
}
