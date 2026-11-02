import { describe, expect, it, vi } from 'vitest'
import { prepareCursorOptions } from '../../../../../src/main/services/agent/cursor/options'

describe('prepareCursorOptions', () => {
  it('builds local TypeScript SDK options and bridges Halo SDK tools in process', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'done' }] }))
    const prepared = await prepareCursorOptions({
      cwd: '/workspace',
      includePartialMessages: true,
      mcpServers: {
        halo: {
          type: 'sdk',
          instance: {
            name: 'halo',
            version: '1.0.0',
            listTools: () => [
              { name: 'keep', description: 'Keep me', inputSchema: { type: 'object' } },
              { name: 'disabled', inputSchema: { type: 'object' } },
            ],
            callTool,
          },
        },
      },
      disabledMcpTools: { halo: ['disabled'] },
    }, {
      CURSOR_API_KEY: 'cursor-secret',
      HALO_CURSOR_MODEL: 'composer-test',
    })

    expect(prepared.agentOptions).toMatchObject({
      apiKey: 'cursor-secret',
      model: { id: 'composer-test' },
      local: { cwd: '/workspace', settingSources: [] },
    })
    expect(Object.keys(prepared.agentOptions.local!.customTools!)).toEqual(['mcp__halo__keep'])

    const result = await prepared.agentOptions.local!.customTools!.mcp__halo__keep.execute(
      { value: 'x' },
      { toolCallId: 'call-1' },
    )
    expect(callTool).toHaveBeenCalledWith('keep', { value: 'x' })
    expect(result).toEqual({ content: [{ type: 'text', text: 'done' }], isError: false })
  })

  it('passes external stdio and HTTP MCP servers to Cursor without a sidecar', async () => {
    const prepared = await prepareCursorOptions({
      cwd: '/workspace',
      mcpServers: {
        local: { command: 'node', args: ['server.js'], env: { TOKEN: 'x' }, cwd: '/mcp' },
        remote: { type: 'sse', url: 'https://example.test/sse', headers: { Authorization: 'Bearer x' } },
      },
    }, { CURSOR_API_KEY: 'cursor-secret' })

    expect(prepared.agentOptions.mcpServers).toEqual({
      local: { type: 'stdio', command: 'node', args: ['server.js'], env: { TOKEN: 'x' }, cwd: '/mcp' },
      remote: { type: 'sse', url: 'https://example.test/sse', headers: { Authorization: 'Bearer x' } },
    })
    expect(prepared.mcpServerNames).toEqual(['local', 'remote'])
  })

  it('allows the SDK to use its stored login when no API key is in the environment', async () => {
    const prepared = await prepareCursorOptions({ cwd: '/workspace', model: 'gpt-5.6-sol' }, {})
    expect(prepared.agentOptions.apiKey).toBeUndefined()
    expect(prepared.agentOptions.model).toEqual({ id: 'gpt-5.6-sol' })
  })

  it('keeps HALO_CURSOR_MODEL as an explicit deployment override', async () => {
    const prepared = await prepareCursorOptions(
      { cwd: '/workspace', model: 'gpt-5.6-sol' },
      { HALO_CURSOR_MODEL: 'composer-2.5' },
    )
    expect(prepared.agentOptions.model).toEqual({ id: 'composer-2.5' })
  })

  it('fails closed when an external MCP server has per-tool disables', async () => {
    const prepared = await prepareCursorOptions({
      cwd: '/workspace',
      mcpServers: {
        external: { command: 'node', args: ['server.js'] },
      },
      disabledMcpTools: { external: ['dangerous_tool'] },
    }, { CURSOR_API_KEY: 'cursor-secret' })

    expect(prepared.agentOptions.mcpServers).toBeUndefined()
    expect(prepared.mcpServerNames).not.toContain('external')
  })
})
