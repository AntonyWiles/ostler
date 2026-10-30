import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIG_MIGRATIONS, ConfigStore } from '../../electron/config-store'
import { useTempDir } from '../helpers/temp-dir'

/** How much to show (interface levels) was removed: one layout for everyone. */
describe('config migration 40 (interface-level)', () => {
  const dir = useTempDir('ostler-interface-level-')

  it('drops a saved level and keeps the rest of ui', () => {
    const migration = CONFIG_MIGRATIONS.find((entry) => entry.version === 40)
    expect(migration?.name).toBe('interface-level')

    const saved: Record<string, unknown> = { ui: { theme: 'dark', interfaceLevel: 'essentials' } }
    migration?.up(saved, { newInstall: false })
    expect(saved.ui).toEqual({ theme: 'dark' })

    const fresh: Record<string, unknown> = {}
    migration?.up(fresh, { newInstall: true })
    expect(fresh).toEqual({})
  })

  it('applies through the config store', () => {
    fs.writeFileSync(
      path.join(dir(), 'old.json'),
      JSON.stringify({ configVersion: 39, ui: { interfaceLevel: 'standard' } })
    )
    const old = new ConfigStore(path.join(dir(), 'old.json'))
    expect('interfaceLevel' in old.get().ui).toBe(false)
    expect(new ConfigStore(path.join(dir(), 'fresh.json')).get().ui).not.toHaveProperty(
      'interfaceLevel'
    )
  })
})
