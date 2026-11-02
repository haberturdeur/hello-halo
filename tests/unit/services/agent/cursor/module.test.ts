import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => '/tmp/halo-cursor-module-test',
    getAppPath: () => '/tmp/halo-cursor-module-test',
  },
}))

import { createCursorSdkModule } from '../../../../../src/main/services/agent/cursor'

describe('Cursor SDK engine module', () => {
  it('composes the direct TypeScript SDK behind Halo SDK-compatible exports', async () => {
    const agent = {
      agentId: 'agent-1',
      send: vi.fn(),
      close: vi.fn(),
      [Symbol.asyncDispose]: vi.fn(async () => {}),
    }
    const sdk = {
      Agent: {
        create: vi.fn(async () => agent),
        resume: vi.fn(),
      },
      Cursor: {
        models: {
          list: vi.fn(async () => [
            { id: 'composer-2.5', displayName: 'Composer 2.5', description: 'Fast agent model' },
            { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol' },
          ]),
        },
      },
    }
    const module = createCursorSdkModule(sdk as any)

    await module.initialize()
    expect(module.capabilities.engineId).toBe('cursor')
    expect(module.capabilities.modelSelection).toMatchObject({
      managedBy: 'engine',
      sourceId: 'engine:cursor',
      defaultModel: 'auto',
      models: [
        { id: 'auto', name: 'Auto' },
        { id: 'composer-2.5', name: 'Composer 2.5', description: 'Fast agent model' },
        { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
      ],
    })
    expect(module.capabilities.features.permissionRules).toBe(false)
    expect(module.capabilities.features.sessionResume).toBe(true)
    expect(module.tool).toBeTypeOf('function')
    expect(module.createSdkMcpServer).toBeTypeOf('function')

    const session = await module.createSession({ cwd: '/workspace' }, {
      CURSOR_API_KEY: 'cursor-secret',
    })
    expect(session.sessionId).toBe('agent-1')
    await session.close()
  })

  it('keeps the auto fallback when catalog discovery fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const module = createCursorSdkModule({
      Agent: {} as any,
      Cursor: { models: { list: vi.fn(async () => { throw new Error('offline') }) } },
    } as any)

    await expect(module.initialize()).resolves.toBeUndefined()
    expect(module.capabilities.modelSelection?.models).toEqual([{ id: 'auto', name: 'Auto' }])
    warn.mockRestore()
  })

  it('uses an explicit Cursor API key for catalog discovery', async () => {
    const list = vi.fn(async () => [{ id: 'auto', displayName: 'Auto' }])
    const module = createCursorSdkModule({
      Agent: {} as any,
      Cursor: { models: { list } },
    } as any, { CURSOR_API_KEY: 'cursor-test-key' })

    await module.initialize()

    expect(list).toHaveBeenCalledWith({ apiKey: 'cursor-test-key' })
  })

  it('discovers the model catalog only once across repeated initialization', async () => {
    const list = vi.fn(async () => [{ id: 'auto', displayName: 'Auto' }])
    const module = createCursorSdkModule({
      Agent: {} as any,
      Cursor: { models: { list } },
    } as any)

    await Promise.all([module.initialize(), module.initialize()])

    expect(list).toHaveBeenCalledOnce()
  })

  it('advertises the deployment model override as the effective engine model', () => {
    const module = createCursorSdkModule({ Agent: {} as any } as any, {
      HALO_CURSOR_MODEL: 'composer-2.5',
    })

    expect(module.capabilities.modelSelection?.deploymentModel).toBe('composer-2.5')
  })
})
