import * as fs from 'fs'
import * as path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../electron/safe-storage', () => ({
  isEncryptionAvailable: () => true,
  isEncryptedSecret: (value: string) => value.startsWith('ostler-secure:v1:'),
  encryptApiKey: (key: string) => key,
  decryptApiKey: (value: string) => value,
  sealSecret: (token: string) => token,
  openSecret: (value: string) => value
}))

import { CONFIG_MIGRATIONS, ConfigStore } from '../../electron/config-store'
import { useTempDir } from '../helpers/temp-dir'

const OFF = { cadence: 'off', weekday: 1, since: null }

describe('config migration 29 status-update-reminder (N5.5)', () => {
  const tempDir = useTempDir('ostler-status-reminder-')
  let configPath: string

  beforeEach(() => {
    configPath = path.join(tempDir(), 'config.json')
  })

  const migration = () => CONFIG_MIGRATIONS.find((entry) => entry.version === 29)!

  it('turns every existing project reminder off, and keeps the rest of the project', () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        configVersion: 28,
        projects: [
          { id: 'a', name: 'A', path: null, color: '#fff', enabled: true, stage: 'on-hold' },
          { id: 'b', name: 'B', path: null, color: '#fff', enabled: false }
        ]
      })
    )
    const config = new ConfigStore(configPath).get()
    expect(config.projects.map((project) => project.updateReminder)).toEqual([OFF, OFF])
    expect(config.projects[0].stage).toBe('on-hold')
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(onDisk.configVersion).toBeGreaterThanOrEqual(29)
    expect(onDisk.projects[1].updateReminder).toEqual(OFF)
  })

  it('keeps a reminder it can read and replaces the rest', () => {
    const raw: Record<string, unknown> = {
      projects: [
        { updateReminder: { cadence: 'fortnightly', weekday: 4, since: '2026-10-01' } },
        { updateReminder: { cadence: 'daily', weekday: 9 } },
        'not a project'
      ]
    }
    migration().up(raw, { newInstall: false })
    expect(raw.projects).toEqual([
      { updateReminder: { cadence: 'fortnightly', weekday: 4, since: '2026-10-01' } },
      { updateReminder: OFF },
      'not a project'
    ])
  })

  it('starts a new project off and sets and checks the reminder through updateProject', () => {
    const store = new ConfigStore(configPath)
    const project = store.registerProject({ name: 'P', folder: null })
    expect(project.updateReminder).toEqual(OFF)
    const saved = store.updateProject(project.id, {
      updateReminder: { cadence: 'weekly', weekday: 5, since: null }
    }).updateReminder
    expect(saved).toMatchObject({ cadence: 'weekly', weekday: 5 })
    expect(saved?.since).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(() =>
      store.updateProject(project.id, {
        updateReminder: { cadence: 'hourly', weekday: 1, since: null } as never
      })
    ).toThrow(/cadence/)
    expect(new ConfigStore(configPath).getProjects()[0].updateReminder).toEqual(saved)
  })
})
