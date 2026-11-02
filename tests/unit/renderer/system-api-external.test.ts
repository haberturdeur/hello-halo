import { beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({
  browserOpen: vi.fn(),
  windowOpen: vi.fn(),
}))

vi.mock('@capacitor/browser', () => ({ Browser: { open: env.browserOpen } }))
vi.mock('../../../src/renderer/api/_shared', () => ({
  httpRequest: vi.fn(),
  isElectron: () => false,
  isCapacitor: () => true,
}))

import { systemApi } from '../../../src/renderer/api/system.api'

describe('system API external URLs', () => {
  beforeEach(() => {
    env.browserOpen.mockReset().mockResolvedValue(undefined)
    env.windowOpen.mockReset()
    vi.stubGlobal('window', { open: env.windowOpen })
  })

  it('opens URLs through the native browser in Capacitor', async () => {
    await systemApi.openExternal('https://issuer.example/login')
    expect(env.browserOpen).toHaveBeenCalledWith({ url: 'https://issuer.example/login' })
    expect(env.windowOpen).not.toHaveBeenCalled()
  })
})
