import { describe, expect, it } from 'vitest'
import {
  agentEffortConnection,
  agentRunModelChoices,
  resolveAgentModel,
  type AgentModelConfig
} from '../../src/shared/agent-model'
import { getModelOptions } from '../../src/shared/model-options'

const settings = (harness: Partial<AgentModelConfig['harness']> = {}): AgentModelConfig => ({
  ai: { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium', baseUrl: '' },
  harness: { agentProvider: '', agentModel: '', agentEffort: '', ...harness }
})

const projectDefault = {
  aiOverrideEnabled: true,
  defaultProvider: 'anthropic',
  defaultModel: 'claude-opus-5-5',
  defaultEffort: 'high' as const
}

describe('resolveAgentModel (D42: the run, else the project, else Settings)', () => {
  it("uses the run's own model and effort first", () => {
    expect(
      resolveAgentModel(settings(), projectDefault, { model: 'claude-haiku-5-5', effort: 'low' })
    ).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low', source: 'run' })
  })

  it("uses the project's default when the run chose nothing", () => {
    for (const run of [undefined, null, { model: '', effort: '' as const }]) {
      expect(resolveAgentModel(settings(), projectDefault, run)).toEqual({
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        effort: 'high',
        source: 'project'
      })
    }
  })

  it('uses Settings › Agents when neither the run nor the project chose', () => {
    const own = settings({ agentProvider: 'openai', agentModel: 'gpt-5', agentEffort: 'xhigh' })
    expect(resolveAgentModel(own, null)).toEqual({
      provider: 'openai',
      model: 'gpt-5',
      effort: 'xhigh',
      source: 'settings'
    })
    // A project whose override is off is "Same as Settings".
    expect(resolveAgentModel(own, { ...projectDefault, aiOverrideEnabled: false })).toMatchObject({
      model: 'gpt-5',
      source: 'settings'
    })
  })

  it('falls back to the Ostler AI model and effort on "Same as Ostler AI"', () => {
    expect(resolveAgentModel(settings(), undefined)).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      effort: 'medium',
      source: 'settings'
    })
  })

  it('keeps the provider in effect: a run chooses a model, never a provider', () => {
    const own = settings({ agentProvider: 'openai', agentModel: 'gpt-5' })
    expect(resolveAgentModel(own, null, { model: 'gpt-4o', effort: '' }).provider).toBe('openai')
  })

  it('a run that names only an effort keeps the default model', () => {
    expect(resolveAgentModel(settings(), projectDefault, { model: '', effort: 'low' })).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      effort: 'low',
      source: 'run'
    })
  })
})

describe('agentRunModelChoices', () => {
  it('offers the Settings list for the provider in effect, with the default first', () => {
    const choices = agentRunModelChoices(settings(), null)
    expect(choices[0]).toBe('claude-sonnet-5-5')
    expect(choices).toEqual(
      expect.arrayContaining(getModelOptions('anthropic', '').map((option) => option.value))
    )
    expect(choices).not.toContain('gpt-5')
  })

  it('includes a project model the list does not name', () => {
    expect(
      agentRunModelChoices(settings(), { ...projectDefault, defaultModel: 'claude-custom-1' })
    ).toContain('claude-custom-1')
  })
})

describe('agentEffortConnection', () => {
  it('passes the Ostler AI address only for a custom provider or the Ostler AI provider', () => {
    const base = settings()
    const config = { ...base, ai: { ...base.ai, baseUrl: 'https://example.test/v1' } }
    expect(agentEffortConnection(config, 'openai', 'gpt-5')).toEqual({
      provider: 'openai',
      model: 'gpt-5'
    })
    expect(agentEffortConnection(config, 'anthropic', 'claude-haiku-5-5').baseUrl).toBe(
      'https://example.test/v1'
    )
  })
})
