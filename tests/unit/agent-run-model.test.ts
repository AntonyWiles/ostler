import { describe, expect, it, vi } from 'vitest'
import {
  validateAgentRunChoice,
  validateRunAgainChoice,
  type EffortSupportCheck
} from '../../electron/services/agent-run-model'
import type { OstlerConfig, WatchedProject } from '../../src/shared/ostler-api'
import { DEFAULT_CONFIG } from '../../src/shared/ostler-api'

const config: OstlerConfig = {
  ...DEFAULT_CONFIG,
  ai: { ...DEFAULT_CONFIG.ai, provider: 'anthropic', model: 'claude-sonnet-5-5', effort: '' }
}
const project = { id: 'project-1', name: 'Garden' } as WatchedProject
// What the provider says the model takes, as the Settings Effort field asks it.
const effortSupport = vi.fn<EffortSupportCheck>(async (draft) => ({
  model: draft.model ?? '',
  levels: ['low', 'high'],
  source: 'listing'
}))
const check = (input: unknown) => validateAgentRunChoice(config, project, input, effortSupport)

describe('validateAgentRunChoice (one check for the app and the automation API)', () => {
  it('accepts a model Settings offers and an effort its provider takes', async () => {
    await expect(check({ model: 'claude-haiku-5-5', effort: 'low' })).resolves.toEqual({
      model: 'claude-haiku-5-5',
      effort: 'low'
    })
    expect(effortSupport).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', model: 'claude-haiku-5-5' })
    )
  })

  it('accepts the default without asking the provider', async () => {
    effortSupport.mockClear()
    await expect(check({})).resolves.toEqual({ model: '', effort: '' })
    await expect(check({ model: '  ', effort: '' })).resolves.toEqual({ model: '', effort: '' })
    expect(effortSupport).not.toHaveBeenCalled()
  })

  it('refuses a model the provider in effect is not offered', async () => {
    await expect(check({ model: 'gpt-5' })).rejects.toThrow(
      '"gpt-5" is not a model Settings offers for anthropic.'
    )
  })

  it('refuses an effort the provider of the model does not take', async () => {
    await expect(check({ model: 'claude-haiku-5-5', effort: 'max' })).rejects.toThrow(
      'claude-haiku-5-5 does not take the effort "max".'
    )
  })

  it('refuses what is not an effort level or a model name at all', async () => {
    await expect(check({ effort: 'turbo' })).rejects.toThrow(/is not an effort level/)
    await expect(check({ model: 42 })).rejects.toThrow('The model must be text.')
  })

  it('checks an effort alone against the default model', async () => {
    effortSupport.mockClear()
    await expect(check({ effort: 'high' })).resolves.toEqual({ model: '', effort: 'high' })
    expect(effortSupport).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-5-5' })
    )
  })
})

describe('validateRunAgainChoice', () => {
  it('takes a model only when the task goes back to the queue', async () => {
    await expect(
      validateRunAgainChoice(config, project, 'retry', { model: 'claude-haiku-5-5' }, effortSupport)
    ).resolves.toEqual({ model: 'claude-haiku-5-5', effort: '' })
    await expect(
      validateRunAgainChoice(config, project, 'hold', { model: 'claude-haiku-5-5' })
    ).rejects.toThrow(/only when the task is run again/)
    await expect(validateRunAgainChoice(config, project, 'rework', undefined)).resolves.toBe(
      undefined
    )
  })
})
