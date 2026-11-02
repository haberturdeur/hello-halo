import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultCapabilitiesFor, type EngineId } from '../../../../src/main/services/agent/capabilities'
import { ALL_ENGINE_IDS } from '../../../../src/main/services/agent/engine-availability'

describe('Cursor engine registration', () => {
  it('registers cursor as an exact opt-in engine with verified SDK capabilities', () => {
    const engineId = 'cursor' as EngineId
    const capabilities = defaultCapabilitiesFor(engineId)

    expect(ALL_ENGINE_IDS).toContain('cursor')
    expect(capabilities.engineId).toBe('cursor')
    expect(capabilities.prompt.nativeAgentGuidance).toBe(true)
    expect(capabilities.features.permissionRules).toBe(false)
    expect(capabilities.features.sessionResume).toBe(true)
    expect(capabilities.features.interrupt).toBe(true)
    expect(capabilities.features.multimodalImage).toBe(true)
    expect(capabilities.features.goal).toBe(false)
  })

  it('describes the direct TypeScript SDK without sidecar coupling', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../')
    const files = [
      'src/main/services/agent/engine-availability.ts',
      'src/main/services/agent/resolved-sdk.ts',
      'src/renderer/components/settings/AdvancedSection.tsx',
    ]
    const registration = files.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')

    expect(registration).toContain('@cursor/sdk')
    expect(registration).not.toContain('Omnigent')
    expect(registration).not.toContain('Python')
    expect(registration).not.toContain('HALO_CURSOR_RUNTIME_DIR')
  })
})
