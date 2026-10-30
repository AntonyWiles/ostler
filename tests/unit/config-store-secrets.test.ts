import * as fs from 'fs'
import * as path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A reversible safeStorage whose availability the test switches, so one
// config file can be saved without encryption and opened again with it.
const storage = vi.hoisted(() => ({ available: false }))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => storage.available,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`),
    decryptString: (buffer: Buffer) => {
      const value = buffer.toString('utf-8')
      if (!value.startsWith('sealed:')) throw new Error('bad')
      return value.slice('sealed:'.length)
    }
  }
}))

import { ConfigStore } from '../../electron/config-store'
import { useTempDir } from '../helpers/temp-dir'

describe('stored secrets', () => {
  const tempDir = useTempDir('ostler-config-secrets-')
  let configPath: string

  beforeEach(() => {
    storage.available = false
    configPath = path.join(tempDir(), 'config.json')
  })

  it('saves every secret plain without safeStorage and encrypts them on the next start with it', () => {
    const store = new ConfigStore(configPath)
    store.update({ ai: { ...store.get().ai, apiKey: 'sk-secret' } })
    store.update({ github: { token: 'ghp_secret' } })
    const project = store.registerProject({ folder: null, name: 'Project' })
    const { automationToken } = store.generateAutomationToken(project.id)
    const plain = fs.readFileSync(configPath, 'utf8')
    expect(plain).toContain('sk-secret')
    expect(plain).toContain('ghp_secret')
    expect(plain).toContain(automationToken!)

    storage.available = true
    const reloaded = new ConfigStore(configPath)
    expect(reloaded.get().ai.apiKey).toBe('sk-secret')
    expect(reloaded.get().github.token).toBe('ghp_secret')
    expect(reloaded.getProjects()[0].automationToken).toBe(automationToken)
    const sealed = fs.readFileSync(configPath, 'utf8')
    expect(sealed).not.toContain('sk-secret')
    expect(sealed).not.toContain('ghp_secret')
    expect(sealed).not.toContain(automationToken!)

    const again = new ConfigStore(configPath).get()
    expect(again.ai.apiKey).toBe('sk-secret')
    expect(again.github.token).toBe('ghp_secret')
  })

  it('still drops an encrypted key it cannot open', () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        ai: { apiKey: 'ostler-secure:v1:AAAA' },
        github: { token: 'ostler-secure:v1:BBBB' }
      })
    )
    const config = new ConfigStore(configPath).get()
    expect(config.ai.apiKey).toBe('')
    expect(config.github.token).toBe('')
  })
})
