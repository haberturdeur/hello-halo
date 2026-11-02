import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => '/tmp/halo-cursor-session-test',
    getAppPath: () => '/tmp/halo-cursor-session-test',
  },
}))

import { CursorSession } from '../../../../../src/main/services/agent/cursor/session-adapter'

async function collect(iterable: AsyncIterable<any>): Promise<any[]> {
  const items: any[] = []
  for await (const item of iterable) items.push(item)
  return items
}

function fakeRun(messages: any[], result: any = { id: 'run-1', status: 'finished', result: 'hello' }) {
  return {
    id: 'run-1',
    agentId: 'agent-1',
    status: 'running',
    supports: vi.fn(() => true),
    unsupportedReason: vi.fn(),
    stream: async function* () {
      for (const message of messages) yield message
    },
    wait: vi.fn(async () => result),
    cancel: vi.fn(async () => {}),
    conversation: vi.fn(async () => []),
    onDidChangeStatus: vi.fn(() => () => {}),
  }
}

describe('CursorSession', () => {
  it('creates a local agent and exposes one canonical Halo turn per send', async () => {
    const run = fakeRun([{
      type: 'assistant',
      agent_id: 'agent-1',
      run_id: 'run-1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    }])
    const agent = {
      agentId: 'agent-1',
      send: vi.fn(async () => run),
      close: vi.fn(),
      [Symbol.asyncDispose]: vi.fn(async () => {}),
    }
    const sdk = {
      Agent: {
        create: vi.fn(async () => agent),
        resume: vi.fn(),
      },
    }

    const session = await CursorSession.create(sdk as any, {
      cwd: '/workspace',
      includePartialMessages: false,
    }, { CURSOR_API_KEY: 'cursor-secret', HALO_CURSOR_MODEL: 'auto' })
    session.send('hello')
    const frames = await collect(session.stream())

    expect(sdk.Agent.create).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'cursor-secret',
      local: expect.objectContaining({ cwd: '/workspace' }),
    }))
    expect(agent.send).toHaveBeenCalledWith('hello')
    expect(frames[0]).toEqual(expect.objectContaining({ type: 'system', subtype: 'init' }))
    expect(frames.at(-1)).toEqual(expect.objectContaining({ type: 'result', is_error: false }))
    expect(frames.filter(frame => frame.type === 'result')).toHaveLength(1)
    expect(session.sessionId).toBe('agent-1')
  })

  it('resumes by agent id and cancels the active SDK run on interrupt', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const run = fakeRun([])
    run.stream = async function* () {
      await gate
    }
    const agent = {
      agentId: 'agent-1',
      send: vi.fn(async () => run),
      close: vi.fn(),
      [Symbol.asyncDispose]: vi.fn(async () => {}),
    }
    const sdk = {
      Agent: {
        create: vi.fn(),
        resume: vi.fn(async () => agent),
      },
    }

    const session = await CursorSession.create(sdk as any, {
      cwd: '/workspace',
      resume: 'agent-1',
    }, { CURSOR_API_KEY: 'cursor-secret' })
    session.send('continue')
    const streaming = collect(session.stream())
    await vi.waitFor(() => expect(agent.send).toHaveBeenCalled())

    await session.interrupt()
    release()
    await streaming

    expect(sdk.Agent.resume).toHaveBeenCalledWith('agent-1', expect.any(Object))
    expect(run.cancel).toHaveBeenCalledOnce()
  })

  it('disposes the SDK agent exactly once', async () => {
    const dispose = vi.fn(async () => {})
    const agent = {
      agentId: 'agent-1',
      send: vi.fn(),
      close: vi.fn(),
      [Symbol.asyncDispose]: dispose,
    }
    const sdk = { Agent: { create: vi.fn(async () => agent), resume: vi.fn() } }
    const session = await CursorSession.create(
      sdk as any,
      { cwd: '/workspace' },
      { CURSOR_API_KEY: 'cursor-secret' },
    )

    await Promise.all([session.close(), session.close(), session.flush()])

    expect(dispose).toHaveBeenCalledOnce()
    expect(session.query.transport.isReady()).toBe(false)
  })

  it('seeds Halo host context once without replacing Cursor native guidance', async () => {
    const firstRun = fakeRun([])
    const secondRun = fakeRun([], { id: 'run-2', status: 'finished', result: 'again' })
    const agent = {
      agentId: 'agent-1',
      send: vi.fn()
        .mockResolvedValueOnce(firstRun)
        .mockResolvedValueOnce(secondRun),
      close: vi.fn(),
      [Symbol.asyncDispose]: vi.fn(async () => {}),
    }
    const sdk = { Agent: { create: vi.fn(async () => agent), resume: vi.fn() } }
    const session = await CursorSession.create(sdk as any, {
      cwd: '/workspace',
      systemPrompt: { type: 'preset', preset: 'default', append: 'You are Halo.' },
    }, { CURSOR_API_KEY: 'cursor-secret' })

    session.send('first')
    await collect(session.stream())
    session.send('second')
    await collect(session.stream())

    expect(agent.send.mock.calls[0][0]).toContain('You are Halo.')
    expect(agent.send.mock.calls[0][0]).toContain('first')
    expect(agent.send.mock.calls[1][0]).toBe('second')
  })
})
