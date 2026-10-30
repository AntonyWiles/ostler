import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type OstlerConfig } from '../../src/shared/ostler-api'
import { checkAgentRequirements } from '../../electron/services/agent-requirements'

function configWith(ai: Partial<OstlerConfig['ai']>): OstlerConfig {
  return { ...DEFAULT_CONFIG, ai: { ...DEFAULT_CONFIG.ai, ...ai } }
}

const READY = configWith({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' })

describe('checkAgentRequirements', () => {
  it('reports Git missing when git --version cannot run', async () => {
    const result = await checkAgentRequirements({
      gitVersion: async () => null,
      runtimePresent: () => true,
      getConfig: () => READY
    })
    expect(result).toEqual({ gitVersion: null, aiConfigured: true, runtimePresent: true })
  })

  it('reports Ostler AI not set up without a model, or without a key for a cloud provider', async () => {
    for (const config of [
      configWith({ provider: 'openai', model: '', apiKey: 'sk-test' }),
      configWith({ provider: 'openai', model: 'gpt-4o', apiKey: '' })
    ]) {
      const result = await checkAgentRequirements({
        gitVersion: async () => 'git version 2.47.0.windows.1',
        runtimePresent: () => true,
        getConfig: () => config
      })
      expect(result.aiConfigured).toBe(false)
    }
  })

  it('passes everything when Git, Ostler AI and the runtime are all there', async () => {
    const result = await checkAgentRequirements({
      gitVersion: async () => 'git version 2.47.0.windows.1',
      runtimePresent: () => true,
      getConfig: () => READY
    })
    expect(result).toEqual({
      gitVersion: 'git version 2.47.0.windows.1',
      aiConfigured: true,
      runtimePresent: true
    })
  })
})
