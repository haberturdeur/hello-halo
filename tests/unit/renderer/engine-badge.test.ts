import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/renderer/i18n', () => ({
  useTranslation: () => ({
    t: (text: string, values?: { engine?: string }) =>
      values?.engine ? text.replace('{{engine}}', values.engine) : text,
  }),
}))

import { EngineBadge } from '../../../src/renderer/components/chat/EngineBadge'

describe('EngineBadge', () => {
  it('labels Cursor conversations as Cursor SDK rather than Halo SDK', () => {
    const badge = EngineBadge({ engineId: 'cursor' })

    expect(badge?.props.children).toBe('Cursor')
    expect(badge?.props.title).toContain('Cursor SDK')
  })
})
