import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type HarnessSession, type OstlerConfig } from '../../src/shared/ostler-api'
import {
  fromRendererConfigUpdate,
  fromRendererProjectUpdate,
  toRendererConfig,
  toRendererSession
} from '../../src/shared/renderer-config'
import { makeWatchedProject } from '../helpers/projects'

const AI_KEY = 'sk-live-ABCDEFGHIJKL9876'
const AUTOMATION_TOKEN = 'automation-token-secret-value'

function configWithSecrets(): OstlerConfig {
  const project = (id: string, automationToken?: string) =>
    makeWatchedProject({
      id,
      name: id,
      path: `C:/projects/${id}`,
      color: '#000000',
      automationToken
    })
  return {
    ...DEFAULT_CONFIG,
    ai: { ...DEFAULT_CONFIG.ai, apiKey: AI_KEY },
    projects: [project('one', `${AUTOMATION_TOKEN}-one`), project('two')]
  }
}

describe('toRendererConfig', () => {
  it('puts no secret anywhere in its JSON output', () => {
    const json = JSON.stringify(toRendererConfig(configWithSecrets()))
    for (const secret of [AI_KEY, AUTOMATION_TOKEN]) {
      expect(json).not.toContain(secret)
    }
    expect(json).not.toContain('"apiKey"')
    expect(json).not.toContain('harnessToken')
    expect(json).not.toContain('"automationToken"')
  })

  it('sets the key and token flags from the source', () => {
    const renderer = toRendererConfig(configWithSecrets())
    expect(renderer.ai.hasApiKey).toBe(true)
    expect(renderer.ai.apiKeyHint).toBe('9876')
    expect(renderer.projects.map((project) => project.hasAutomationToken)).toEqual([true, false])

    const empty = toRendererConfig(DEFAULT_CONFIG)
    expect(empty.ai.hasApiKey).toBe(false)
    expect(empty.ai.apiKeyHint).toBe('')
  })

  it('keeps every other setting as it is', () => {
    const renderer = toRendererConfig(configWithSecrets())
    expect(renderer.harness).toEqual(DEFAULT_CONFIG.harness)
    expect(renderer.ai.model).toBe(DEFAULT_CONFIG.ai.model)
    expect(renderer.projects[0].path).toBe('C:/projects/one')
  })
})

describe('renderer updates', () => {
  it('drops projects and an empty key from a config update', () => {
    expect(
      fromRendererConfigUpdate({
        projects: [],
        ai: { apiKey: '  ', model: 'm' }
      } as never)
    ).toEqual({ ai: { model: 'm' } })
    expect(fromRendererConfigUpdate({ ai: { apiKey: ' new-key ' } })).toEqual({
      ai: { apiKey: 'new-key' }
    })
  })

  it('never takes the second place for backups from a config update', () => {
    expect(
      fromRendererConfigUpdate({
        backups: { keep: 3, copyTo: 'C:\\Windows', lastCopiedAt: 1, copyFailedAt: 2 }
      })
    ).toEqual({ backups: { keep: 3 } })
  })

  it('drops the id and tokens from a project update', () => {
    expect(
      fromRendererProjectUpdate({
        name: 'Renamed',
        id: 'other',
        automationToken: 'y',
        hasAutomationToken: true
      } as never)
    ).toEqual({ name: 'Renamed' })
  })

  it('returns a started session without its token', () => {
    const session = { id: 's1', token: 'session-secret' } as HarnessSession
    expect(toRendererSession(session)).toEqual({ id: 's1' })
  })
})
