import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  anthropicMessagesBody,
  createProvider,
  getModelEffortSupport
} from '../../electron/services/ai-provider'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Bad Request' })

function sentBody(fetchMock: { mock: { calls: unknown[][] } }, call = 0): Record<string, unknown> {
  return JSON.parse(String((fetchMock.mock.calls[call][1] as RequestInit).body))
}

describe('effort', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('request bodies', () => {
    it('sends Anthropic effort as output_config.effort, and nothing without one', () => {
      const base = { model: 'claude-opus-5-5', maxTokens: 100, temperature: 0, stream: false }
      expect(anthropicMessagesBody([], { ...base, effort: 'low' }).output_config).toEqual({
        effort: 'low'
      })
      expect(anthropicMessagesBody([], base)).not.toHaveProperty('output_config')
    })

    it('sends OpenAI chat effort as reasoning_effort', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}))
      await createProvider('openai', 'https://api.openai.com/v1', 'k', 'gpt-4o').testConnection(
        'gpt-4o',
        'high'
      )
      expect(sentBody(fetchMock).reasoning_effort).toBe('high')
    })

    it('sends OpenRouter effort as reasoning.effort', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}))
      await createProvider('custom', 'https://openrouter.ai/api/v1', 'k', 'x/y').testConnection(
        'x/y',
        'medium'
      )
      const body = sentBody(fetchMock)
      expect(body.reasoning).toEqual({ effort: 'medium' })
      expect(body).not.toHaveProperty('reasoning_effort')
    })

    it('sends Responses effort as reasoning.effort', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}))
      await createProvider('openai', 'https://api.openai.com/v1', 'k', 'gpt-5').testConnection(
        'gpt-5',
        'low'
      )
      expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/responses$/)
      expect(sentBody(fetchMock).reasoning).toEqual({ effort: 'low' })
    })

    it('sends Gemini effort as generationConfig.thinkingConfig.thinkingLevel', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}))
      await createProvider('google', '', 'k', 'gemini-3.5-flash').testConnection(
        'gemini-3.5-flash',
        'minimal'
      )
      expect(sentBody(fetchMock).generationConfig).toEqual({
        thinkingConfig: { thinkingLevel: 'minimal' }
      })
    })

    it('chat leaves effort out unless one is set', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }))
      const provider = createProvider('openai', 'https://api.openai.com/v1', 'k', 'gpt-4o')
      for await (const chunk of provider.chat([{ role: 'user', content: 'hi' }], {
        model: 'gpt-4o',
        maxTokens: 10,
        temperature: 0,
        stream: true
      }))
        void chunk
      expect(sentBody(fetchMock)).not.toHaveProperty('reasoning_effort')
    })
  })

  describe('getModelEffortSupport', () => {
    it("reads Anthropic's capabilities.effort, keeping only supported levels", async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        json({
          id: 'claude-sonnet-4-6',
          capabilities: {
            effort: {
              supported: true,
              low: { supported: true },
              medium: { supported: true },
              high: { supported: true },
              max: { supported: true },
              xhigh: { supported: false }
            }
          }
        })
      )
      const support = await getModelEffortSupport('anthropic', '', 'k', 'claude-sonnet-4-6')
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        'https://api.anthropic.com/v1/models/claude-sonnet-4-6'
      )
      expect(support).toEqual({
        model: 'claude-sonnet-4-6',
        levels: ['low', 'medium', 'high', 'max'],
        source: 'listing'
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('reports no levels for an Anthropic model whose effort is unsupported', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        json({ capabilities: { effort: { supported: false, low: { supported: false } } } })
      )
      const support = await getModelEffortSupport('anthropic', '', 'k', 'claude-3-haiku')
      expect(support.levels).toEqual([])
    })

    it("reads OpenRouter's reasoning.supported_efforts, and none without reasoning", async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        json({
          data: [
            { id: 'a/thinker', reasoning: { supported_efforts: ['high', 'medium', 'low'] } },
            { id: 'a/any', reasoning: { supported_efforts: null } },
            { id: 'a/plain' }
          ]
        })
      )
      const base = 'https://openrouter.ai/api/v1'
      expect((await getModelEffortSupport('custom', base, 'k', 'a/thinker')).levels).toEqual([
        'low',
        'medium',
        'high'
      ])
      expect((await getModelEffortSupport('custom', base, 'k', 'a/any')).levels).toEqual([
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
        'max'
      ])
      expect((await getModelEffortSupport('custom', base, 'k', 'a/plain')).levels).toEqual([])
    })

    it("trusts Google's thinking: false without sending any test request", async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(json({ name: 'models/gemma', thinking: false }))
      const support = await getModelEffortSupport('google', '', 'k', 'gemma')
      expect(support).toEqual({ model: 'gemma', levels: [], source: 'listing' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('tests each level against OpenAI and keeps only the ones it accepts', async () => {
      const accepted = new Set(['low', 'medium', 'high'])
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body))
        const effort = body.reasoning_effort ?? body.reasoning?.effort
        if (effort === undefined || accepted.has(effort)) return json({})
        return json({ error: { message: `Unsupported value: '${effort}'` } }, 400)
      })
      const support = await getModelEffortSupport(
        'openai',
        'https://api.openai.com/v1',
        'k',
        'o-test'
      )
      expect(support).toEqual({
        model: 'o-test',
        levels: ['low', 'medium', 'high'],
        source: 'test'
      })
    })

    it('fails instead of greying everything out when the plain request fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: { message: 'bad key' } }, 401))
      await expect(
        getModelEffortSupport('openai', 'https://api.openai.com/v1', 'k', 'gpt-4o')
      ).rejects.toThrow(/401/)
    })

    it('fails on a rate limit mid-check rather than calling the level unsupported', async () => {
      let calls = 0
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        ++calls === 1 ? json({}) : json({ error: { message: 'slow down' } }, 429)
      )
      await expect(
        getModelEffortSupport('openai', 'https://api.openai.com/v1', 'k', 'gpt-4o')
      ).rejects.toThrow(/429/)
    })
  })
})
