import { describe, expect, it, vi } from 'vitest'
import {
  AI_PRESETS,
  aiPresetProblems,
  isLoopbackUrl,
  presetForSettings,
  type AiPreset
} from '../../src/shared/ai-presets'
import { findLocalAiProvider } from '../../electron/services/ai-local-detect'

describe('AI presets', () => {
  it('validate', () => {
    expect(aiPresetProblems()).toEqual([])
  })

  it('offer the local, cloud and other choices the setup lists', () => {
    expect(AI_PRESETS.filter((preset) => preset.kind === 'local').map((p) => p.id)).toEqual([
      'ollama',
      'lmstudio'
    ])
    expect(AI_PRESETS.filter((preset) => preset.kind === 'cloud').map((p) => p.id)).toEqual([
      'openai',
      'anthropic',
      'google',
      'openrouter'
    ])
    expect(AI_PRESETS.find((preset) => preset.kind === 'other')?.id).toBe('other')
  })

  it('report a preset that breaks the rules', () => {
    const bad: AiPreset = {
      ...AI_PRESETS[0],
      id: 'ollama',
      needsKey: true,
      defaultBaseUrl: 'http://example.com/v1',
      docsUrl: 'http://ollama.com'
    }
    expect(aiPresetProblems([bad, bad])).toEqual(
      expect.arrayContaining([
        'ollama: duplicate id',
        'ollama: the docs link must be https',
        'ollama: a local provider needs no key',
        "ollama: a local provider's address must be on this computer"
      ])
    )
  })

  it('recognise saved settings', () => {
    expect(
      presetForSettings({ provider: 'custom', baseUrl: 'http://localhost:11434/v1/' }).id
    ).toBe('ollama')
    expect(presetForSettings({ provider: 'openai', baseUrl: '' }).id).toBe('openai')
    expect(presetForSettings({ provider: 'custom', baseUrl: 'https://my.server/v1' }).id).toBe(
      'other'
    )
  })

  it('know a loopback address', () => {
    expect(isLoopbackUrl('http://127.0.0.1:1234/v1')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:11434')).toBe(true)
    expect(isLoopbackUrl('https://api.openai.com/v1')).toBe(false)
    expect(isLoopbackUrl('not a url')).toBe(false)
  })
})

describe('finding a local provider', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  it('lists the models when Ollama answers, asking only its default address', async () => {
    const fetchImpl = vi.fn(async () => json({ data: [{ id: 'qwen3' }, { id: 'llama3.2' }] }))
    const found = await findLocalAiProvider('ollama', fetchImpl as never)
    expect(found).toEqual({
      status: 'found',
      baseUrl: 'http://localhost:11434/v1',
      models: [
        { id: 'llama3.2', label: 'llama3.2' },
        { id: 'qwen3', label: 'qwen3' }
      ]
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe('http://localhost:11434/v1/models')
  })

  it('says how to start it, with an https download link, when nothing answers', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    })
    const result = await findLocalAiProvider('lmstudio', fetchImpl as never)
    expect(result.status).toBe('not-found')
    if (result.status !== 'not-found') return
    expect(result.message).toContain('Nothing is answering at http://localhost:1234/v1')
    expect(result.message).toContain('Is LM Studio running?')
    expect(result.downloadUrl).toMatch(/^https:\/\//)
  })

  it('tells a wrong service apart from no service', async () => {
    const html = vi.fn(async () => new Response('<html>hello</html>', { status: 200 }))
    expect((await findLocalAiProvider('ollama', html as never)).status).toBe('wrong-service')
    const missing = vi.fn(async () => new Response('Not found', { status: 404 }))
    expect((await findLocalAiProvider('ollama', missing as never)).status).toBe('wrong-service')
    const otherJson = vi.fn(async () => json({ status: 'ok' }))
    expect((await findLocalAiProvider('ollama', otherJson as never)).status).toBe('wrong-service')
  })

  it('never probes a provider that is not local', async () => {
    const fetchImpl = vi.fn()
    await expect(findLocalAiProvider('openai', fetchImpl as never)).rejects.toThrow(
      'Only a local provider'
    )
    await expect(findLocalAiProvider('http://192.168.1.2', fetchImpl as never)).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
