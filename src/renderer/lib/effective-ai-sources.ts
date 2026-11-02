import { hasAnyAISource, type AISource, type AISourcesConfig } from '../../shared/types/ai-sources'
import type { EngineCapabilities } from '../types'

type CatalogCapabilities = Pick<EngineCapabilities, 'displayName' | 'modelSelection'>

export function hasUsableModelSource(
  config: AISourcesConfig,
  capabilities: CatalogCapabilities | null,
): boolean {
  return hasAnyAISource(config) || (capabilities?.modelSelection?.models.length ?? 0) > 0
}

export function overlayEngineModelCatalog(
  config: AISourcesConfig,
  capabilities: CatalogCapabilities | null,
  selectedModel?: string,
): AISourcesConfig {
  const selection = capabilities?.modelSelection
  if (!selection || selection.managedBy !== 'engine') return config

  const model = selection.deploymentModel
    || (selectedModel && selection.models.some(item => item.id === selectedModel)
      ? selectedModel
      : selection.defaultModel)
  const availableModels = selection.models.some(item => item.id === model)
    ? selection.models
    : [...selection.models, { id: model, name: model }]
  const source: AISource = {
    id: selection.sourceId,
    name: capabilities.displayName,
    provider: 'cursor',
    authType: 'engine',
    apiUrl: '',
    model,
    availableModels,
    createdAt: '',
    updatedAt: '',
  }

  return {
    ...config,
    currentId: source.id,
    sources: [...config.sources.filter(item => item.id !== source.id), source],
  }
}
