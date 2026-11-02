import type { AISourcesConfig } from '../../shared/types/ai-sources'
import { overlayEngineModelCatalog } from '../lib/effective-ai-sources'
import { useAppStore } from '../stores/app.store'
import { useEngineCapabilities } from '../stores/engine.store'

const EMPTY_SOURCES: AISourcesConfig = { version: 2, currentId: null, sources: [] }

export function useEffectiveAiSources(): AISourcesConfig {
  const config = useAppStore(state => state.config)
  const capabilities = useEngineCapabilities()
  const persisted = config?.aiSources?.version === 2 ? config.aiSources : EMPTY_SOURCES
  return overlayEngineModelCatalog(persisted, capabilities, config?.agent?.engineModel)
}
