import * as fs from 'fs'
import * as path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('../../electron/safe-storage', () => ({
  isEncryptionAvailable: () => true,
  isEncryptedSecret: (value: string) => value.startsWith('ostler-secure:v1:'),
  encryptApiKey: (key: string) => key,
  decryptApiKey: (value: string) => value,
  sealSecret: (token: string) => token,
  openSecret: (value: string) => value
}))

const { ConfigStore, LATEST_CONFIG_VERSION } = await import('../../electron/config-store')

describe('Triage new captures, config migration 34 (N4.3a)', () => {
  const tempDir = useTempDir('ostler-triage-setting-')
  let configPath: string

  beforeEach(() => {
    configPath = path.join(tempDir(), 'config.json')
  })

  it('turns it off for every existing project, keeping one already set', () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        configVersion: 33,
        projects: [
          { id: 'a', name: 'A', path: null, color: '#fff', enabled: true },
          { id: 'b', name: 'B', path: null, color: '#fff', enabled: true, triageCaptures: true }
        ]
      })
    )
    const store = new ConfigStore(configPath)
    const [a, b] = store.getProjects()
    expect(a.triageCaptures).toBe(false)
    expect(b.triageCaptures).toBe(true)
    expect(LATEST_CONFIG_VERSION).toBeGreaterThanOrEqual(34)
  })

  it('starts a new project off, and saves only true or false', () => {
    const store = new ConfigStore(configPath)
    const project = store.registerProject({ name: 'P', folder: null })
    expect(project.triageCaptures).toBe(false)
    expect(store.updateProject(project.id, { triageCaptures: true }).triageCaptures).toBe(true)
    expect(() => store.updateProject(project.id, { triageCaptures: 'yes' as never })).toThrow(
      'Triage new captures is true or false'
    )
    expect(new ConfigStore(configPath).getProjects()[0].triageCaptures).toBe(true)
  })
})
