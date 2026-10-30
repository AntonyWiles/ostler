import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activeAiRequestCount,
  createProvider,
  setAiActivityListener,
  AnthropicProvider,
  anthropicAcceptsTemperature,
  OpenAICompatibleProvider,
  OpenAIResponsesProvider,
  resolveCustomProviderEndpointStyle
} from '../../electron/services/ai-provider'
import { AI_PRESETS } from '../../src/shared/ai-presets'

const OPEN_CODE_BASE_URL = 'https://opencode.ai/zen/go/v1'
const MODEL = 'muse-spark-1.2-contributor'

describe('ai-provider.ts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('counts a model request as busy until its response arrives', async () => {
    let respond: (response: Response) => void = () => {}
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise<Response>((resolve) => {
        respond = resolve
      })
    )
    const seen: number[] = []
    setAiActivityListener((count) => seen.push(count))
    try {
      const provider = createProvider('custom', OPEN_CODE_BASE_URL, 'test-key', MODEL)
      const pending = provider.testConnection(MODEL)
      expect(activeAiRequestCount()).toBe(1)
      respond(new Response('{}', { status: 200, statusText: 'OK' }))
      await pending
      expect(activeAiRequestCount()).toBe(0)
      expect(seen).toEqual([1, 0])
    } finally {
      setAiActivityListener(null)
    }
  })

  it('uses the Responses API for the OpenCode Go Muse model', () => {
    const provider = createProvider('custom', OPEN_CODE_BASE_URL, 'test-key', MODEL)

    expect(provider).toBeInstanceOf(OpenAIResponsesProvider)
  })

  it('uses the Responses API for current OpenAI reasoning models', () => {
    const provider = createProvider(
      'openai',
      'https://api.openai.com/v1',
      'test-key',
      'gpt-5.6-sol'
    )

    expect(provider).toBeInstanceOf(OpenAIResponsesProvider)
  })

  it('accepts OpenCode-prefixed model IDs and trims the base URL', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200, statusText: 'OK' }))
    const prefixedModel = `opencode-go/${MODEL}`
    const provider = createProvider('custom', `${OPEN_CODE_BASE_URL}/  `, 'test-key', prefixedModel)

    expect(provider).toBeInstanceOf(OpenAIResponsesProvider)
    await provider.testConnection(prefixedModel)

    expect(fetchMock.mock.calls[0][1]?.body).toContain(`"model":"${MODEL}"`)
  })

  it('does not append a second endpoint when a full OpenCode Responses URL is configured', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200, statusText: 'OK' }))
    const fullEndpoint = `${OPEN_CODE_BASE_URL}/responses`
    const provider = createProvider('custom', fullEndpoint, 'test-key', MODEL)

    expect(provider).toBeInstanceOf(OpenAIResponsesProvider)
    await provider.testConnection(MODEL)

    expect(fetchMock).toHaveBeenCalledWith(fullEndpoint, expect.anything())
  })

  it('does not append a second endpoint when a full OpenCode Chat URL is configured', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200, statusText: 'OK' }))
    const model = 'glm-5.3'
    const fullEndpoint = `${OPEN_CODE_BASE_URL}/chat/completions`
    const provider = createProvider('custom', fullEndpoint, 'test-key', model)

    expect(provider).toBeInstanceOf(OpenAICompatibleProvider)
    await provider.testConnection(model)

    expect(fetchMock).toHaveBeenCalledWith(fullEndpoint, expect.anything())
  })

  it('uses the Messages API for OpenCode Go message models', () => {
    const provider = createProvider('custom', OPEN_CODE_BASE_URL, 'test-key', 'minimax-m3')

    expect(provider).toBeInstanceOf(AnthropicProvider)
  })

  it('identifies OpenCode in compatible-provider errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        statusText: 'Internal Server Error'
      })
    )
    const provider = createProvider('custom', OPEN_CODE_BASE_URL, 'test-key', 'glm-5.3')

    await expect(provider.testConnection('glm-5.3')).rejects.toThrow(
      'OpenCode API error: 500 Internal Server Error — Internal server error'
    )
  })

  it('uses the Responses API for OpenCode Zen response models', () => {
    const provider = createProvider('custom', 'https://opencode.ai/zen/v1', 'test-key', 'gpt-5.5')

    expect(provider).toBeInstanceOf(OpenAIResponsesProvider)
  })

  it('keeps ordinary custom providers on chat completions', () => {
    const provider = createProvider('custom', 'https://example.test/v1', 'test-key', 'test-model')

    expect(provider).toBeInstanceOf(OpenAICompatibleProvider)
  })

  it('tests a Responses endpoint without exposing the API key in the request body', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200, statusText: 'OK' }))
    const provider = new OpenAIResponsesProvider(OPEN_CODE_BASE_URL, 'test-key')

    await expect(provider.testConnection(MODEL)).resolves.toMatchObject({ model: MODEL })

    expect(fetchMock).toHaveBeenCalledWith(
      `${OPEN_CODE_BASE_URL}/responses`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        body: expect.stringContaining(`"model":"${MODEL}"`)
      })
    )
    expect(fetchMock.mock.calls[0][1]?.body).not.toContain('test-key')
  })

  it('reads streamed Responses output deltas', async () => {
    const stream = [
      'event: response.output_text.delta\n',
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.output_text.delta","delta":" world"}\n\n',
      'data: [DONE]\n\n'
    ].join('')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }))
    const provider = new OpenAIResponsesProvider(OPEN_CODE_BASE_URL, 'test-key')
    const chunks: string[] = []

    for await (const chunk of provider.chat([{ role: 'user', content: 'hello' }], {
      model: MODEL,
      maxTokens: 10,
      temperature: 0,
      stream: true
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(['Hello', ' world'])
  })

  it('keeps a final Responses delta that has no trailing newline', async () => {
    const stream = 'data: {"type":"response.output_text.delta","delta":"complete"}'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }))
    const provider = new OpenAIResponsesProvider(OPEN_CODE_BASE_URL, 'test-key')
    const chunks: string[] = []

    for await (const chunk of provider.chat([{ role: 'user', content: 'hello' }], {
      model: MODEL,
      maxTokens: 10,
      temperature: 0,
      stream: true
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(['complete'])
  })

  it('falls back to completed Responses text when a gateway omits delta events', async () => {
    const stream =
      'data: {"type":"response.completed","response":{"output":[{"content":[{"type":"output_text","text":"{\\"summary\\":\\"draft\\"}"}]}]}}\n\n'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }))
    const provider = new OpenAIResponsesProvider(OPEN_CODE_BASE_URL, 'test-key')
    const chunks: string[] = []

    for await (const chunk of provider.chat([{ role: 'user', content: 'hello' }], {
      model: MODEL,
      maxTokens: 10,
      temperature: 0,
      stream: true
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(['{"summary":"draft"}'])
  })

  it('includes a safe provider error detail for authentication failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'invalid API key' } }), {
        status: 401,
        statusText: 'Unauthorized'
      })
    )
    const provider = new OpenAIResponsesProvider(OPEN_CODE_BASE_URL, 'test-key')

    await expect(provider.testConnection(MODEL)).rejects.toThrow(
      'OpenAI Responses API error: 401 Unauthorized — invalid API key'
    )
  })

  it('sends a stable x-opencode-session header to OpenCode Go', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
      )
    const provider = createProvider('custom', OPEN_CODE_BASE_URL, 'test-key', 'mimo-v2.5', 'sess-1')

    await provider.testConnection('mimo-v2.5')

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['x-opencode-session']).toBe('sess-1')
  })

  it('falls back to a generated session id when no conversation id is supplied', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
      )
    const provider = createProvider('custom', OPEN_CODE_BASE_URL, 'test-key', 'mimo-v2.5')

    await provider.testConnection('mimo-v2.5')

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['x-opencode-session']).toMatch(/^ostler-/)
  })

  it('does not send an OpenCode session header to unrelated providers', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
      )
    const provider = createProvider('openai', 'https://api.openai.com/v1', 'test-key', 'gpt-4o')

    await provider.testConnection('gpt-4o')

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['x-opencode-session']).toBeUndefined()
  })

  it('includes the endpoint and model in compatible-provider errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        statusText: 'Internal Server Error'
      })
    )
    const provider = new OpenAICompatibleProvider('https://api.openai.com/v1', 'test-key')

    await expect(provider.testConnection('gpt-4o')).rejects.toThrow(
      'OpenAI API error: 500 Internal Server Error — Internal server error [endpoint: chat/completions; model: gpt-4o]'
    )
  })

  describe('temperature on Anthropic requests', () => {
    const okStream = () =>
      new Response('event: message_stop\ndata: {}\n\n', { status: 200, statusText: 'OK' })

    async function sentBody(
      model: string,
      provider = 'anthropic',
      baseUrl = 'https://api.anthropic.com/v1'
    ) {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okStream())
      const p = createProvider(provider as 'anthropic', baseUrl, 'test-key', model)
      const chunks: string[] = []
      for await (const chunk of p.chat([{ role: 'user', content: 'hi' }], {
        model,
        maxTokens: 100,
        temperature: 0.2,
        stream: true
      })) {
        chunks.push(chunk)
      }
      await p.testConnection(model)
      return fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
    }

    it('leaves temperature out for Anthropic models that reject it, on chat and the test', async () => {
      const bodies = await sentBody('claude-haiku-5-5')
      expect(bodies).toHaveLength(2)
      for (const body of bodies) {
        expect(body).not.toHaveProperty('temperature')
        expect(body.model).toBe('claude-haiku-5-5')
      }
    })

    it('still sends temperature to older Anthropic models that accept it', async () => {
      const [chat, test] = await sentBody('claude-sonnet-4-5-20250929')
      expect(chat.temperature).toBe(0.2)
      expect(test.temperature).toBe(0)
    })

    it('still sends temperature to other providers', async () => {
      const [chat] = await sentBody('llama3', 'custom', 'http://localhost:11434/v1')
      expect(chat.temperature).toBe(0.2)
    })

    it('knows which Claude models take temperature', () => {
      for (const id of [
        'claude-3-haiku-20240307',
        'claude-3-5-sonnet-latest',
        'claude-sonnet-4-20250514',
        'claude-opus-4-1',
        'claude-haiku-4-5',
        'claude-opus-4-6'
      ]) {
        expect(anthropicAcceptsTemperature(id), id).toBe(true)
      }
      for (const id of ['claude-opus-4-7', 'claude-haiku-5-5', 'claude-opus-5-5', 'claude-fable']) {
        expect(anthropicAcceptsTemperature(id), id).toBe(false)
      }
    })
  })

  describe('OpenCode Zen routing', () => {
    const ZEN = 'https://opencode.ai/zen/v1'

    it('sends every Claude model, the 5.5 models included, to the messages endpoint', () => {
      const presetClaude = AI_PRESETS.map((preset) => preset.recommendedModel).filter((id) =>
        id.startsWith('claude-')
      )
      expect(presetClaude).toContain('claude-sonnet-5-5')
      for (const id of [
        ...presetClaude,
        'claude-opus-5-5',
        'claude-fable-5-5',
        'claude-haiku-5-5',
        'claude-opus-5',
        'claude-sonnet-4-5',
        'opencode/claude-opus-5-5'
      ]) {
        expect(resolveCustomProviderEndpointStyle(ZEN, id), id).toBe('messages')
      }
    })

    it('leaves other families where they were', () => {
      expect(resolveCustomProviderEndpointStyle(ZEN, 'gpt-5.5')).toBe('responses')
      expect(resolveCustomProviderEndpointStyle(ZEN, 'muse-spark-1.2')).toBe('responses')
      expect(resolveCustomProviderEndpointStyle(ZEN, 'qwen3.7-max')).toBe('messages')
      expect(resolveCustomProviderEndpointStyle(ZEN, 'gemini-3-pro')).toBe('chat-completions')
      expect(
        resolveCustomProviderEndpointStyle('https://openrouter.ai/api/v1', 'claude-opus-5-5')
      ).toBe('chat-completions')
    })
  })
})
