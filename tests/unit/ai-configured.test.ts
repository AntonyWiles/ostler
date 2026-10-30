import { describe, expect, it } from 'vitest'
import { isAiConfigured } from '../../src/shared/ai-configured'

const base = { provider: 'openai' as const, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' }

describe('isAiConfigured', () => {
  it('needs a model and a key', () => {
    expect(isAiConfigured({ ...base, hasApiKey: true })).toBe(true)
    expect(isAiConfigured({ ...base, hasApiKey: false })).toBe(false)
    expect(isAiConfigured({ ...base, model: ' ', hasApiKey: true })).toBe(false)
  })

  it('accepts a keyless provider on this computer', () => {
    for (const baseUrl of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:1234/v1',
      'http://[::1]:8080/v1'
    ]) {
      expect(
        isAiConfigured({ provider: 'custom', baseUrl, model: 'llama3', hasApiKey: false })
      ).toBe(true)
    }
  })

  it('still needs a key for a remote custom endpoint', () => {
    expect(
      isAiConfigured({
        provider: 'custom',
        baseUrl: 'https://example.test/v1',
        model: 'm',
        hasApiKey: false
      })
    ).toBe(false)
    expect(
      isAiConfigured({ provider: 'custom', baseUrl: 'not a url', model: 'm', hasApiKey: false })
    ).toBe(false)
  })
})
