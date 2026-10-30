import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type OstlerConfig } from '../../src/shared/ostler-api'
import { listProviderModels } from '../../electron/services/ai-provider'
import { requireAi, testAiConnection } from '../../electron/services/ai-access'

function ollama(): OstlerConfig {
  const config = structuredClone(DEFAULT_CONFIG)
  config.ai.provider = 'custom'
  config.ai.baseUrl = 'http://localhost:11434/v1'
  config.ai.apiKey = ''
  config.ai.model = 'llama3.2'
  return config
}

function headersOf(call: unknown[]): Record<string, string> {
  return ((call[1] as RequestInit | undefined)?.headers ?? {}) as Record<string, string>
}

describe('a keyless local provider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('counts as set up, and the gate hands out a provider', () => {
    expect(() => requireAi(ollama(), null)).not.toThrow()
    const remote = ollama()
    remote.ai.baseUrl = 'https://example.test/v1'
    expect(() => requireAi(remote, null)).toThrow("isn't set up")
  })

  it('sends no Authorization header when chatting, testing or listing models', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', {
          status: 200
        })
    )
    const { provider, model } = requireAi(ollama(), null)
    let reply = ''
    for await (const chunk of provider.chat([{ role: 'user', content: 'hello' }], {
      model,
      maxTokens: 10,
      temperature: 0,
      stream: true
    })) {
      reply += chunk
    }
    expect(reply).toBe('hi')
    await testAiConnection(ollama())
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ data: [{ id: 'llama3.2' }] }), { status: 200 })
    )
    await listProviderModels('custom', 'http://localhost:11434/v1', '')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const call of fetchMock.mock.calls) {
      expect(Object.keys(headersOf(call as unknown[]))).not.toContain('Authorization')
    }
  })

  it('still sends the key when there is one', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('{}', { status: 200 }))
    const config = ollama()
    config.ai.apiKey = 'secret'
    await testAiConnection(config)
    expect(headersOf(fetchMock.mock.calls[0] as unknown[]).Authorization).toBe('Bearer secret')
  })
})
