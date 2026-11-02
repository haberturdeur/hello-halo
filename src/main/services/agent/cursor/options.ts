import type {
  AgentOptions,
  McpServerConfig,
  SDKCustomTool,
  SDKCustomToolContent,
  SDKCustomToolResult,
  SDKJsonValue,
} from '@cursor/sdk'
import { partitionMcpServers } from '../mcp/partition'
import { hostSystemPromptText } from '../system-prompt'

export interface PreparedCursorOptions {
  agentOptions: AgentOptions
  mcpServerNames: string[]
  includePartialMessages: boolean
  initialContext: string
}

export async function prepareCursorOptions(
  sdkOptions: Record<string, any>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PreparedCursorOptions> {
  const apiKey = env.CURSOR_API_KEY?.trim()

  const configured = sdkOptions.mcpServers as Record<string, unknown> | undefined
  const { sdk, external, unusable } = partitionMcpServers(configured)
  if (unusable.length > 0) {
    console.warn(`[Cursor][options] MCP servers Halo cannot describe: ${unusable.join(', ')}`)
  }

  const disabled = (sdkOptions.disabledMcpTools ?? {}) as Record<string, string[]>
  const customTools: Record<string, SDKCustomTool> = {}
  const mcpServerNames: string[] = []
  for (const [serverName, instance] of Object.entries(sdk)) {
    const blocked = new Set(disabled[serverName] ?? [])
    for (const definition of instance.listTools()) {
      if (blocked.has(definition.name)) continue
      customTools[`mcp__${serverName}__${definition.name}`] = {
        description: definition.description,
        inputSchema: definition.inputSchema as Record<string, SDKJsonValue>,
        annotations: definition.annotations as SDKCustomTool['annotations'],
        execute: async (args) => normalizeCustomToolResult(
          await instance.callTool(definition.name, args as Record<string, unknown>),
        ),
      }
    }
    mcpServerNames.push(serverName)
  }

  const mcpServers: Record<string, McpServerConfig> = {}
  for (const [name, server] of Object.entries(external)) {
    if ((disabled[name]?.length ?? 0) > 0) {
      console.warn(
        `[Cursor][options] Omitting external MCP server "${name}" because the Cursor SDK ` +
        'cannot enforce its per-tool disables.',
      )
      continue
    }
    mcpServers[name] = server.transport === 'stdio'
      ? {
          type: 'stdio',
          command: server.command,
          args: server.args,
          env: server.env,
          ...(server.cwd ? { cwd: server.cwd } : {}),
        }
      : {
          type: server.transport,
          url: server.url,
          headers: server.headers,
        }
    mcpServerNames.push(name)
  }

  const model = String(env.HALO_CURSOR_MODEL?.trim() || sdkOptions.model || 'auto')
  const cwd = String(sdkOptions.cwd || process.cwd())
  return {
    agentOptions: {
      ...(apiKey ? { apiKey } : {}),
      model: { id: model },
      local: {
        cwd,
        settingSources: [],
        ...(Object.keys(customTools).length > 0 ? { customTools } : {}),
      },
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
    },
    mcpServerNames,
    includePartialMessages: sdkOptions.includePartialMessages !== false,
    initialContext: hostSystemPromptText(sdkOptions.systemPrompt),
  }
}

function normalizeCustomToolResult(result: unknown): SDKCustomToolResult {
  if (typeof result === 'string') return result
  if (!result || typeof result !== 'object') {
    return result === undefined ? '' : String(result)
  }

  const record = result as Record<string, any>
  if (!Array.isArray(record.content)) return record as SDKJsonValue

  const content: SDKCustomToolContent[] = []
  for (const item of record.content) {
    if (item?.type === 'text') {
      content.push({ type: 'text', text: String(item.text ?? '') })
    }
    if (item?.type === 'image' && typeof item.data === 'string') {
      content.push({
        type: 'image',
        data: item.data,
        ...(item.mimeType || item.mime_type ? { mimeType: String(item.mimeType || item.mime_type) } : {}),
      })
    }
  }
  return {
    content,
    isError: Boolean(record.isError),
    ...(record.structuredContent && typeof record.structuredContent === 'object'
      ? { structuredContent: record.structuredContent as Record<string, SDKJsonValue> }
      : {}),
  }
}
