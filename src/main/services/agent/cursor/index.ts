import { tool, createSdkMcpServer } from '../mcp/sdk-server'
import { CURSOR_CAPABILITIES } from '../capabilities'
import { CursorSession, type CursorSdkRuntime } from './session-adapter'

export function createCursorSdkModule(
  sdk: CursorSdkRuntime,
  env: NodeJS.ProcessEnv = process.env,
) {
  const deploymentModel = env.HALO_CURSOR_MODEL?.trim()
  const capabilities = {
    ...CURSOR_CAPABILITIES,
    modelSelection: CURSOR_CAPABILITIES.modelSelection
      ? {
          ...CURSOR_CAPABILITIES.modelSelection,
          ...(deploymentModel ? { deploymentModel } : {}),
          models: [
            ...CURSOR_CAPABILITIES.modelSelection.models,
            ...(deploymentModel
              && !CURSOR_CAPABILITIES.modelSelection.models.some(model => model.id === deploymentModel)
              ? [{ id: deploymentModel, name: deploymentModel }]
              : []),
          ],
        }
      : undefined,
  }
  let initialization: Promise<void> | null = null

  const createCursorSession = (
    options: Record<string, any>,
    env: NodeJS.ProcessEnv = process.env,
  ) => CursorSession.create(sdk, options, env)

  return {
    tool,
    createSdkMcpServer,
    capabilities,
    initialize() {
      initialization ??= (async () => {
        if (!sdk.Cursor?.models) return
        try {
          const apiKey = env.CURSOR_API_KEY?.trim()
          const models = apiKey
            ? await sdk.Cursor.models.list({ apiKey })
            : await sdk.Cursor.models.list()
          if (models.length > 0 && capabilities.modelSelection) {
            const normalized = models.map(model => ({
              id: model.id,
              name: model.displayName,
              ...(model.description ? { description: model.description } : {}),
            }))
            const retained = capabilities.modelSelection.models.filter(
              model => (model.id === capabilities.modelSelection?.defaultModel
                || model.id === capabilities.modelSelection?.deploymentModel)
                && !normalized.some(item => item.id === model.id),
            )
            if (deploymentModel
              && !normalized.some(model => model.id === deploymentModel)
              && !retained.some(model => model.id === deploymentModel)) {
              retained.push({ id: deploymentModel, name: deploymentModel })
            }
            capabilities.modelSelection.models = [...retained, ...normalized]
          }
        } catch (error) {
          console.warn('[Cursor] Model catalog unavailable; using auto:', (error as Error).message)
        }
      })()
      return initialization
    },
    createSession: createCursorSession,
    async *query(params: any) {
      const session = await createCursorSession(params?.options ?? {})
      try {
        session.send(params?.prompt ?? 'hi')
        yield* session.stream()
      } finally {
        await session.close()
      }
    },
  }
}
