import { describe, expect, it } from 'vitest'
import { hasUsableModelSource, overlayEngineModelCatalog } from '../../../src/renderer/lib/effective-ai-sources'

describe('overlayEngineModelCatalog', () => {
  const empty = { version: 2 as const, currentId: null, sources: [] }
  const capabilities = {
    displayName: 'Cursor SDK',
    modelSelection: {
      managedBy: 'engine' as const,
      sourceId: 'engine:cursor',
      defaultModel: 'auto',
      models: [
        { id: 'composer-2.5', name: 'Composer 2.5' },
        { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', description: 'Coding model' },
      ],
    },
  }

  it('adds an engine-owned source and makes it the effective global source', () => {
    expect(overlayEngineModelCatalog(empty, capabilities, 'gpt-5.6-sol')).toEqual({
      version: 2,
      currentId: 'engine:cursor',
      sources: [{
        id: 'engine:cursor',
        name: 'Cursor SDK',
        provider: 'cursor',
        authType: 'engine',
        apiUrl: '',
        model: 'gpt-5.6-sol',
        availableModels: capabilities.modelSelection.models,
        createdAt: '',
        updatedAt: '',
      }],
    })
  })

  it('falls back to the engine default when the saved model is unavailable', () => {
    const result = overlayEngineModelCatalog(empty, capabilities, 'removed-model')
    expect(result.sources[0].model).toBe('auto')
  })

  it('uses a deployment model override ahead of the saved selection', () => {
    const result = overlayEngineModelCatalog(empty, {
      ...capabilities,
      modelSelection: {
        ...capabilities.modelSelection,
        deploymentModel: 'deployment-model',
      },
    }, 'gpt-5.6-sol')

    expect(result.sources[0]).toMatchObject({
      model: 'deployment-model',
      availableModels: expect.arrayContaining([
        { id: 'deployment-model', name: 'deployment-model' },
      ]),
    })
  })

  it('returns the persisted sources unchanged without an engine catalog', () => {
    expect(overlayEngineModelCatalog(empty, null, undefined)).toBe(empty)
  })

  it('treats a populated engine catalog as a usable source for setup guards', () => {
    expect(hasUsableModelSource(empty, capabilities)).toBe(true)
    expect(hasUsableModelSource(empty, {
      ...capabilities,
      modelSelection: { ...capabilities.modelSelection, models: [] },
    })).toBe(false)
  })
})
