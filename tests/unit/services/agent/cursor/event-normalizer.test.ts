import { describe, expect, it } from 'vitest'
import { CursorEventNormalizer } from '../../../../../src/main/services/agent/cursor/event-normalizer'

describe('CursorEventNormalizer', () => {
  it('normalizes assistant text into one streamed block and a terminal result', () => {
    const normalizer = new CursorEventNormalizer({
      sessionId: 'agent-1',
      model: 'auto',
      includePartialMessages: true,
      newId: prefix => `${prefix}-1`,
    })

    expect(normalizer.beginTurn()).toEqual([
      expect.objectContaining({ type: 'system', subtype: 'init', session_id: 'agent-1' }),
    ])

    const frames = normalizer.handle({
      type: 'assistant',
      agent_id: 'agent-1',
      run_id: 'run-1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    })

    expect(frames.map(frame => frame.type)).toEqual([
      'stream_event', 'stream_event', 'stream_event',
      'stream_event', 'stream_event', 'stream_event',
    ])
    expect(frames[0].event.type).toBe('message_start')
    expect(frames[2].event.delta).toEqual({ type: 'text_delta', text: 'hello' })
    expect(frames.at(-1)?.event.type).toBe('message_stop')

    const terminal = normalizer.endTurn({ id: 'run-1', status: 'finished', result: 'hello' })
    expect(terminal).toEqual([
      expect.objectContaining({
        type: 'result',
        subtype: 'success',
        session_id: 'agent-1',
        result: 'hello',
        is_error: false,
      }),
    ])
    expect(normalizer.endTurn({ id: 'run-1', status: 'finished' })).toEqual([])
  })

  it('emits tool use before its result and carries usage to the result', () => {
    const normalizer = new CursorEventNormalizer({
      sessionId: 'agent-1',
      model: 'auto',
      includePartialMessages: false,
      newId: prefix => `${prefix}-1`,
    })
    normalizer.beginTurn()

    const started = normalizer.handle({
      type: 'tool_call',
      agent_id: 'agent-1',
      run_id: 'run-1',
      call_id: 'call-1',
      name: 'shell',
      status: 'running',
      args: { command: 'pwd' },
    })
    expect(started.slice(0, 3).map(frame => frame.event?.type)).toEqual([
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
    ])
    expect(started.at(-1)).toEqual(
      expect.objectContaining({
        type: 'assistant',
        message: expect.objectContaining({
          content: [{ type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'pwd' } }],
        }),
      }),
    )

    const completed = normalizer.handle({
      type: 'tool_call',
      agent_id: 'agent-1',
      run_id: 'run-1',
      call_id: 'call-1',
      name: 'shell',
      status: 'completed',
      result: 'ok',
    })
    expect(completed).toEqual([
      expect.objectContaining({
        type: 'user',
        message: expect.objectContaining({
          content: [expect.objectContaining({ type: 'tool_result', tool_use_id: 'call-1', content: 'ok' })],
        }),
      }),
    ])

    normalizer.handle({
      type: 'usage',
      agent_id: 'agent-1',
      run_id: 'run-1',
      usage: {
        inputTokens: 3,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 5,
      },
    })
    expect(normalizer.endTurn({ id: 'run-1', status: 'finished' })[0]).toEqual(
      expect.objectContaining({
        usage: expect.objectContaining({ input_tokens: 3, output_tokens: 2 }),
      }),
    )
  })

  it('maps cancellation and execution errors without inventing success', () => {
    const cancelled = new CursorEventNormalizer({
      sessionId: 'agent-1',
      model: 'auto',
      includePartialMessages: true,
    })
    cancelled.beginTurn()
    expect(cancelled.endTurn({ id: 'run-1', status: 'cancelled' })[0]).toEqual(
      expect.objectContaining({ is_error: false, stop_reason: 'interrupted' }),
    )

    const failed = new CursorEventNormalizer({
      sessionId: 'agent-1',
      model: 'auto',
      includePartialMessages: true,
    })
    failed.beginTurn()
    expect(failed.endTurn({
      id: 'run-2',
      status: 'error',
      error: { message: 'boom', code: 'INTERNAL' },
    })[0]).toEqual(expect.objectContaining({ is_error: true, result: 'boom', stop_reason: 'error' }))
  })
})
