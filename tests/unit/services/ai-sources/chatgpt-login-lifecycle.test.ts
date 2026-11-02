import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { proxyFetch } = vi.hoisted(() => ({ proxyFetch: vi.fn() }))
vi.mock('../../../../src/main/services/proxy-fetch', () => ({ proxyFetch }))

import { ChatGPTProvider } from '../../../../src/main/services/ai-sources/providers/chatgpt.provider'

const jwt = (payload: object) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
const tokens = (userId = 'user-a', accountId = 'account-a') => ({
  access_token: jwt({ exp: 9999999999, 'https://api.openai.com/auth': { chatgpt_account_id: accountId, chatgpt_user_id: userId } }),
  id_token: jwt({ email: 'a@example.com' }), refresh_token: 'fake-refresh'
})
const deviceCode = (suffix = 'a') => ({
  device_auth_id: `device-${suffix}`,
  user_code: `CODE-${suffix.toUpperCase()}`,
  interval: '5'
})
const authorization = () => ({
  authorization_code: 'authorization-code',
  code_challenge: 'server-generated-challenge',
  code_verifier: 'server-generated-verifier'
})

beforeEach(() => {
  vi.clearAllMocks()
  process.getSystemVersion = () => '15.1'
})
afterEach(async () => {
  await new ChatGPTProvider().cancelLogin()
})

describe('ChatGPT authorization ownership', () => {
  async function authorize(userId: string, accountId: string, suffix: string) {
    const provider = new ChatGPTProvider()
    proxyFetch.mockResolvedValueOnce(new Response(JSON.stringify(deviceCode(suffix))))
    const start = await provider.startLogin()
    proxyFetch.mockResolvedValueOnce(new Response(JSON.stringify(authorization())))
      .mockResolvedValueOnce(new Response(JSON.stringify(tokens(userId, accountId))))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ slug: 'account-model' }] })))
    return provider.completeLogin(start.data!.state)
  }

  it('distinguishes users in the same workspace while routing catalogs to that workspace', async () => {
    const first = await authorize('user-a', 'shared-workspace', 'a')
    const second = await authorize('user-b', 'shared-workspace', 'b')
    expect(first.data?.user?.uid).toBe(JSON.stringify(['user-a', 'shared-workspace']))
    expect(second.data?.user?.uid).toBe(JSON.stringify(['user-b', 'shared-workspace']))
    expect((first.data as any)._accountId).toBe('shared-workspace')
    expect(proxyFetch.mock.calls[3][1].headers['ChatGPT-Account-ID']).toBe('shared-workspace')
    expect(proxyFetch.mock.calls[7][1].headers['ChatGPT-Account-ID']).toBe('shared-workspace')
  })

  it('keeps distinct workspaces independent and never treats a workspace-only claim as user identity', async () => {
    const first = await authorize('same-user', 'workspace-a', 'a')
    const second = await authorize('same-user', 'workspace-b', 'b')
    const unknown = await authorize('', 'workspace-a', 'c')
    expect(first.data?.user?.uid).not.toBe(second.data?.user?.uid)
    expect(unknown.success).toBe(true)
    expect(unknown.data?.user?.uid).toBe('')
    expect((unknown.data as any)._accountId).toBe('workspace-a')
  })

  it('uses the official headless device flow and exchanges OpenAI-supplied PKCE material', async () => {
    const provider = new ChatGPTProvider()
    proxyFetch.mockResolvedValueOnce(new Response(JSON.stringify(deviceCode())))
    const start = await provider.startLogin()
    expect(start.data).toMatchObject({
      loginUrl: 'https://auth.openai.com/codex/device',
      state: 'CODE-A',
      userCode: 'CODE-A',
      verificationUri: 'https://auth.openai.com/codex/device'
    })
    expect(JSON.parse(proxyFetch.mock.calls[0][1].body)).toEqual({
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann'
    })

    proxyFetch.mockResolvedValueOnce(new Response(JSON.stringify(authorization())))
      .mockResolvedValueOnce(new Response(JSON.stringify(tokens())))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ slug: 'account-model' }] })))
    const completion = await provider.completeLogin(start.data!.state)
    expect(completion.success).toBe(true)
    expect(JSON.parse(proxyFetch.mock.calls[1][1].body)).toEqual({
      device_auth_id: 'device-a', user_code: 'CODE-A'
    })
    expect(new URLSearchParams(proxyFetch.mock.calls[2][1].body)).toEqual(new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'authorization-code',
      redirect_uri: 'https://auth.openai.com/deviceauth/callback',
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      code_verifier: 'server-generated-verifier'
    }))
  })

  it('verifies legacy identity from the stored access token, not email or workspace alone', () => {
    const provider = new ChatGPTProvider()
    const config = (userId: string) => ({ chatgpt: {
      accessToken: tokens(userId, 'shared-workspace').access_token,
      user: { uid: 'shared-workspace', name: 'same@example.com' }
    } } as any)
    expect(provider.getAccountId(config('user-a'))).toBe(JSON.stringify(['user-a', 'shared-workspace']))
    expect(provider.getAccountId(config('user-b'))).toBe(JSON.stringify(['user-b', 'shared-workspace']))
    expect(provider.getAccountId(config(''))).toBeNull()
    expect(provider.getAccountId({ chatgpt: { accessToken: jwt({
      'https://api.openai.com/auth': { user_id: 'legacy-user', chatgpt_account_id: 'workspace' }
    }) } } as any)).toBe(JSON.stringify(['legacy-user', 'workspace']))
  })

  it('rejects mismatched state without polling and cancellation prevents completion', async () => {
    const provider = new ChatGPTProvider()
    proxyFetch.mockResolvedValueOnce(new Response(JSON.stringify(deviceCode())))
    const start = await provider.startLogin()
    expect((await provider.completeLogin('WRONG-CODE')).success).toBe(false)
    expect(proxyFetch).toHaveBeenCalledTimes(1)
    await provider.cancelLogin()
    expect((await provider.completeLogin(start.data!.state)).success).toBe(false)
    expect(proxyFetch).toHaveBeenCalledTimes(1)
  })
})
