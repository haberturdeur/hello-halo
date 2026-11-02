import type { RunResult, SDKMessage } from '@cursor/sdk'

interface CursorNormalizerOptions {
  sessionId: string
  model: string
  includePartialMessages: boolean
  mcpServerNames?: string[]
  newId?: (prefix: string) => string
}

type Frame = Record<string, any>

export class CursorEventNormalizer {
  private readonly newId: (prefix: string) => string
  private terminal = false
  private usage: Record<string, number> | undefined
  private finalText = ''
  private readonly emittedTools = new Set<string>()

  constructor(private readonly options: CursorNormalizerOptions) {
    this.newId = options.newId ?? ((prefix) =>
      `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
  }

  beginTurn(): Frame[] {
    this.terminal = false
    this.usage = undefined
    this.finalText = ''
    this.emittedTools.clear()
    return [{
      type: 'system',
      subtype: 'init',
      session_id: this.options.sessionId,
      model: this.options.model,
      tools: [],
      mcp_servers: (this.options.mcpServerNames ?? []).map(name => ({ name, status: 'pending' })),
      slash_commands: [],
      skills: [],
      agents: [],
    }]
  }

  handle(message: SDKMessage | Record<string, any>): Frame[] {
    if (this.terminal || !message || typeof message !== 'object') return []
    switch (message.type) {
      case 'assistant':
        return this.assistant(message)
      case 'thinking':
        return this.contentBlock('thinking', String(message.text ?? ''))
      case 'tool_call':
        return this.toolCall(message)
      case 'usage':
        this.usage = toClaudeUsage(message.usage)
        return []
      case 'summary':
        return message.status === 'completed'
          ? [{
              type: 'system',
              subtype: 'compact_boundary',
              session_id: this.options.sessionId,
              compact_metadata: { trigger: 'auto', pre_tokens: 0 },
            }]
          : []
      default:
        return []
    }
  }

  endTurn(result: RunResult | Record<string, any>): Frame[] {
    if (this.terminal) return []
    this.terminal = true
    const status = result.status
    const failed = status === 'error'
    const cancelled = status === 'cancelled'
    const text = failed
      ? String(result.error?.message || result.result || 'Cursor run failed')
      : String(result.result ?? this.finalText)
    return [{
      type: 'result',
      subtype: failed || cancelled ? 'error_during_execution' : 'success',
      session_id: this.options.sessionId,
      result: text,
      is_error: failed,
      stop_reason: failed ? 'error' : cancelled ? 'interrupted' : 'end_turn',
      ...(result.error?.code ? { error_code: result.error.code } : {}),
      ...(this.usage ? { usage: this.usage, cumulative_usage: this.usage } : {}),
    }]
  }

  private assistant(message: Record<string, any>): Frame[] {
    const frames: Frame[] = []
    const content = Array.isArray(message.message?.content) ? message.message.content : []
    for (const block of content) {
      if (block?.type === 'text') {
        const text = String(block.text ?? '')
        this.finalText = text || this.finalText
        frames.push(...this.contentBlock('text', text))
      } else if (block?.type === 'tool_use') {
        frames.push(...this.toolUse(
          String(block.id || this.newId('cursor-call')),
          String(block.name || 'Unknown'),
          asObject(block.input),
        ))
      }
    }
    return frames
  }

  private contentBlock(kind: 'text' | 'thinking', text: string): Frame[] {
    if (!text) return []
    if (!this.options.includePartialMessages) {
      const block = kind === 'text'
        ? { type: 'text', text }
        : { type: 'thinking', thinking: text }
      return [{ type: 'assistant', message: { id: this.newId('cursor-msg'), role: 'assistant', content: [block] } }]
    }
    const index = 0
    const messageId = this.newId('cursor-msg')
    return [
      streamEvent({
        type: 'message_start',
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          model: this.options.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: emptyUsage(),
        },
      }),
      streamEvent({
        type: 'content_block_start',
        index,
        content_block: kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' },
      }),
      streamEvent({
        type: 'content_block_delta',
        index,
        delta: kind === 'text'
          ? { type: 'text_delta', text }
          : { type: 'thinking_delta', thinking: text },
      }),
      streamEvent({ type: 'content_block_stop', index }),
      streamEvent({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: emptyUsage(),
      }),
      streamEvent({ type: 'message_stop' }),
    ]
  }

  private toolCall(message: Record<string, any>): Frame[] {
    const id = String(message.call_id || this.newId('cursor-call'))
    if (message.status === 'running') {
      return this.toolUse(id, String(message.name || 'Unknown'), asObject(message.args))
    }
    if (message.status !== 'completed' && message.status !== 'error') return []
    return [{
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: id,
          content: stringifyResult(message.result),
          is_error: message.status === 'error',
        }],
      },
    }]
  }

  private toolUse(id: string, name: string, input: Record<string, unknown>): Frame[] {
    if (this.emittedTools.has(id)) return []
    this.emittedTools.add(id)
    const mappedName = mapToolName(name)
    return [
      streamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id, name: mappedName, input: {} },
      }),
      streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
      }),
      streamEvent({ type: 'content_block_stop', index: 0 }),
      {
        type: 'assistant',
        message: {
          id: this.newId('cursor-msg'),
          role: 'assistant',
          content: [{ type: 'tool_use', id, name: mappedName, input }],
        },
      },
    ]
  }
}

function streamEvent(event: Record<string, unknown>): Frame {
  return { type: 'stream_event', event }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringifyResult(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  try { return JSON.stringify(value) } catch { return String(value) }
}

function toClaudeUsage(value: any): Record<string, number> {
  return {
    input_tokens: Number(value?.inputTokens ?? 0),
    output_tokens: Number(value?.outputTokens ?? 0),
    cache_read_input_tokens: Number(value?.cacheReadTokens ?? 0),
    cache_creation_input_tokens: Number(value?.cacheWriteTokens ?? 0),
  }
}

function emptyUsage(): Record<string, number> {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  }
}

const TOOL_NAMES: Record<string, string> = {
  shell: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  strReplace: 'Edit',
  grep: 'Grep',
  glob: 'Glob',
  ls: 'Glob',
  webSearch: 'WebSearch',
  webFetch: 'WebFetch',
  updateTodos: 'TodoWrite',
  task: 'Task',
  askQuestion: 'AskUserQuestion',
}

function mapToolName(name: string): string {
  return TOOL_NAMES[name] ?? name
}
