import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => '/tmp/halo-effective-model-test',
    getAppPath: () => '/tmp/halo-effective-model-test',
  },
}))

import {
  resolveEffectiveModelSelection,
  withEffectiveModelSelection,
} from '../../../../src/main/services/agent/effective-model-selection'

const emptySources = { version: 2 as const, currentId: null, sources: [] }
const cursorCapabilities = {
  engineId: 'cursor' as const,
  displayName: 'Cursor SDK',
  modelSelection: {
    managedBy: 'engine' as const,
    sourceId: 'engine:cursor',
    defaultModel: 'auto',
    models: [
      { id: 'auto', name: 'Auto' },
      { id: 'composer-2.5', name: 'Composer 2.5' },
    ],
  },
}

describe('resolveEffectiveModelSelection', () => {
  it('reports the engine default as the inherited selection without saved AI sources', () => {
    expect(resolveEffectiveModelSelection(
      { aiSources: emptySources, agent: { engineModel: undefined } },
      cursorCapabilities,
      {},
    )).toEqual({
      managedBy: 'engine',
      sourceId: 'engine:cursor',
      sourceName: 'Cursor SDK',
      modelId: 'auto',
      modelName: 'Auto',
      inherited: true,
    })
  })

  it('reports an app override on the engine virtual source', () => {
    expect(resolveEffectiveModelSelection(
      { aiSources: emptySources, agent: { engineModel: 'auto' } },
      cursorCapabilities,
      { modelSourceId: 'engine:cursor', modelId: 'composer-2.5' },
    )).toMatchObject({
      sourceId: 'engine:cursor',
      modelId: 'composer-2.5',
      modelName: 'Composer 2.5',
      inherited: false,
    })
  })

  it('falls back to the engine default when the saved global model is no longer catalogued', () => {
    expect(resolveEffectiveModelSelection(
      { aiSources: emptySources, agent: { engineModel: 'removed-model' } },
      cursorCapabilities,
      {},
    )).toMatchObject({
      modelId: 'auto',
      modelName: 'Auto',
      inherited: true,
    })
  })

  it('reports the deployment model override that wins at Cursor execution time', () => {
    expect(resolveEffectiveModelSelection(
      { aiSources: emptySources, agent: { engineModel: 'auto' } },
      {
        ...cursorCapabilities,
        modelSelection: {
          ...cursorCapabilities.modelSelection,
          deploymentModel: 'composer-2.5',
        },
      },
      { modelSourceId: 'engine:cursor', modelId: 'auto' },
    )).toMatchObject({
      modelId: 'composer-2.5',
      modelName: 'Composer 2.5',
    })
  })

  it('adds the resolved inherited selection to an app response without changing its overrides', () => {
    const app = { id: 'work', userOverrides: {} }
    const effective = resolveEffectiveModelSelection(
      { aiSources: emptySources, agent: {} },
      cursorCapabilities,
      app.userOverrides,
    )

    expect(withEffectiveModelSelection(app, effective)).toEqual({
      id: 'work',
      userOverrides: {},
      effectiveModelSelection: {
        managedBy: 'engine',
        sourceId: 'engine:cursor',
        sourceName: 'Cursor SDK',
        modelId: 'auto',
        modelName: 'Auto',
        inherited: true,
      },
    })
    expect(app).toEqual({ id: 'work', userOverrides: {} })
  })
})
