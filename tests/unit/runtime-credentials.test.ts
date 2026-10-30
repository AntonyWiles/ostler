import { afterEach, describe, expect, it } from 'vitest'
import { getRuntimeApiKey } from '../../electron/services/runtime-credentials'
import type { OstlerConfig } from '../../src/shared/ostler-api'

const config = {
  ai: { apiKey: 'stored-key' }
} as OstlerConfig

describe('runtime-credentials.ts', () => {
  const originalKey = process.env.OSTLER_AI_API_KEY

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OSTLER_AI_API_KEY
    else process.env.OSTLER_AI_API_KEY = originalKey
  })

  it('uses the development key without changing the stored config', () => {
    process.env.OSTLER_AI_API_KEY = 'runtime-key'

    expect(getRuntimeApiKey(config)).toBe('runtime-key')
    expect(config.ai.apiKey).toBe('stored-key')
  })

  it('falls back to the configured decrypted key', () => {
    delete process.env.OSTLER_AI_API_KEY

    expect(getRuntimeApiKey(config)).toBe('stored-key')
  })
})
