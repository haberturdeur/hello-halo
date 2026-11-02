import type { AISourcesConfig, StoredModelSelection } from '../../../shared/types/ai-sources'
import { getConfig } from '../../foundation/config.service'
import type { EngineCapabilities } from './capabilities'
import { getEngineCapabilities } from './resolved-sdk'

export interface EffectiveModelSelection {
  managedBy: 'engine' | 'source'
  sourceId: string
  sourceName: string
  modelId: string
  modelName: string
  inherited: boolean
}

interface ModelSelectionConfig {
  aiSources?: AISourcesConfig
  agent?: { engineModel?: string }
}

type ModelCatalogCapabilities = Pick<EngineCapabilities, 'displayName' | 'modelSelection'>

export function resolveEffectiveModelSelection(
  config: ModelSelectionConfig,
  capabilities: ModelCatalogCapabilities | null,
  selection?: StoredModelSelection | null,
): EffectiveModelSelection | null {
  const engine = capabilities?.modelSelection
  if (engine?.managedBy === 'engine') {
    const pinned = selection?.modelSourceId === engine.sourceId ? selection.modelId : undefined
    const saved = config.agent?.engineModel
    const globalModel = saved && engine.models.some(model => model.id === saved)
      ? saved
      : engine.defaultModel
    const modelId = engine.deploymentModel || pinned || globalModel
    return {
      managedBy: 'engine',
      sourceId: engine.sourceId,
      sourceName: capabilities?.displayName || engine.sourceId,
      modelId,
      modelName: engine.models.find(model => model.id === modelId)?.name || modelId,
      inherited: !pinned,
    }
  }

  const sources = config.aiSources
  if (!sources) return null
  const pinnedSource = selection?.modelSourceId
    ? sources.sources.find(source => source.id === selection.modelSourceId)
    : undefined
  const source = pinnedSource
    ?? sources.sources.find(item => item.id === sources.currentId)
  if (!source) return null
  const modelId = pinnedSource && selection?.modelId ? selection.modelId : source.model
  return {
    managedBy: 'source',
    sourceId: source.id,
    sourceName: source.name,
    modelId,
    modelName: source.availableModels.find(model => model.id === modelId)?.name || modelId,
    inherited: !pinnedSource,
  }
}

export function getEffectiveModelSelection(
  selection?: StoredModelSelection | null,
): EffectiveModelSelection | null {
  return resolveEffectiveModelSelection(getConfig(), getEngineCapabilities(), selection)
}

export function withEffectiveModelSelection<T extends object>(
  value: T,
  effectiveModelSelection: EffectiveModelSelection | null,
): T & { effectiveModelSelection: EffectiveModelSelection | null } {
  return { ...value, effectiveModelSelection }
}
