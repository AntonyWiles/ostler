import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import type { ConnectedAccountsService } from '../../electron/services/accounts/connected-accounts-service'
import { TimeBlockMirror } from '../../electron/services/accounts/time-block-mirror'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import {
  allowDevice,
  completePairing,
  createPersonalSpace,
  requestPairing
} from '../../electron/services/sync/personal-space'
import { pullSettings, pushSettings } from '../../electron/services/sync/settings-sync'
import { refreshMembers } from '../../electron/services/sync/sharing'
import {
  identityKeys,
  keyGenerationOf,
  projectKeyFor,
  projectKeyring
} from '../../electron/services/sync/sync-keys'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import { PERSONAL_PROJECT_ID } from '../../electron/services/sync/synced-tables'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

// Sealing needs Electron's safeStorage; a reversible stand-in lets the test seal and open for real.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^enc:/, '')
  }
}))

const SECRET = 'sk-test-SECRET-4242'

describe('settings follow the person across two paired PCs', () => {
  const tempDir = useTempDir('ostler-settings-')
  let root: string
  let projectFolder: string
  let pathA: string
  let pathB: string
  let dbA: Database.Database
  let dbB: Database.Database
  let configA: ConfigStore
  let configB: ConfigStore

  const space = (): string => path.join(root, 'Ostler')
  const personalTransport = (): FolderTransport =>
    new FolderTransport(path.join(space(), 'Personal'))

  const personalKeys = (db: Database.Database) => ({
    projectKey: projectKeyFor(db, PERSONAL_PROJECT_ID) as Buffer,
    keyGeneration: keyGenerationOf(db, PERSONAL_PROJECT_ID),
    privateKey: identityKeys(db).privateKey
  })

  const pushA = (): Promise<number> =>
    pushSettings(dbA, personalTransport(), personalKeys(dbA), configA.getOwn())
  const pullB = () =>
    pullSettings(
      dbB,
      personalTransport(),
      { projectKey: projectKeyring(dbB, PERSONAL_PROJECT_ID) },
      configB
    )
  const pushB = (): Promise<number> =>
    pushSettings(dbB, personalTransport(), personalKeys(dbB), configB.getOwn())
  const pullA = () =>
    pullSettings(
      dbA,
      personalTransport(),
      { projectKey: projectKeyring(dbA, PERSONAL_PROJECT_ID) },
      configA
    )

  const shareIdOf = (db: Database.Database): string =>
    (
      db.prepare("SELECT share_id FROM sync_shares WHERE kind = 'personal'").get() as {
        share_id: string
      }
    ).share_id

  const openPc = async (name: string): Promise<{ db: Database.Database; file: string }> => {
    const file = await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), name)))
    const db = new Database(file)
    attachChangeRecorder(db)
    return { db, file }
  }

  /** Makes the personal share on A and pairs B with it, the way the app does it. */
  const pairB = async (): Promise<void> => {
    await createPersonalSpace(dbA, root, 'Ann laptop')
    const deviceB = await requestPairing(dbB, space(), 'Ben phone')
    await allowDevice(dbA, space(), deviceB)
    expect(await completePairing(dbB, space())).toBe('paired')
    await refreshMembers(
      dbA,
      personalTransport(),
      shareIdOf(dbA),
      projectKeyring(dbA, PERSONAL_PROJECT_ID)
    )
  }

  const configPath = (dir: string): string => path.join(dir, 'config.json')

  beforeEach(async () => {
    root = path.join(tempDir(), 'root')
    fs.mkdirSync(root)
    projectFolder = path.join(tempDir(), 'house')
    fs.mkdirSync(projectFolder)
    const a = await openPc('pc-a')
    const b = await openPc('pc-b')
    dbA = a.db
    dbB = b.db
    pathA = a.file
    pathB = b.file
    configA = new ConfigStore(configPath(path.dirname(pathA)))
    configB = new ConfigStore(configPath(path.dirname(pathB)))
    await pairB()
  })

  afterEach(() => {
    dbA.close()
    dbB.close()
  })

  it('a theme, a language and a notification switch changed on A show on B', async () => {
    configA.update({
      ui: { theme: 'dark', language: 'en' },
      notifications: { onBlocker: false }
    })
    expect(await pushA()).toBeGreaterThan(0)

    const result = await pullB()

    expect(result.applied).toEqual(expect.arrayContaining(['ui', 'notifications']))
    expect(configB.get().ui.theme).toBe('dark')
    expect(configB.get().ui.language).toBe('en')
    expect(configB.get().notifications.onBlocker).toBe(false)
  })

  it('device-only settings stay on each PC: the project folder, the automation token and port, sign-in start and the window file', async () => {
    configA.registerProject({ name: 'House', folder: projectFolder })
    configA.update({
      automationApi: { enabled: true, port: 9100 },
      harness: { ...configA.getOwn().harness, port: 9200, enabled: true },
      desktop: { ...configA.getOwn().desktop, startAtLogin: true, quickAddHotkeyEnabled: true },
      ui: { theme: 'dark' }
    })
    configB.update({
      automationApi: { enabled: false, port: 8935 },
      harness: { ...configB.getOwn().harness, port: 8934, enabled: false },
      desktop: { ...configB.getOwn().desktop, startAtLogin: false, quickAddHotkeyEnabled: false }
    })
    const bBefore = configB.getOwn()
    const projectsBefore = configB.getProjects()
    // The window file (electron/window-state.ts) is not in config.json; the pop-out list is.
    const popOutsBefore = bBefore.popOuts

    await pushA()
    await pullB()

    const after = configB.getOwn()
    expect(configB.getProjects()).toEqual(projectsBefore)
    expect(after.automationApi).toEqual(bBefore.automationApi)
    expect(after.harness.port).toBe(8934)
    expect(after.harness.enabled).toBe(false)
    expect(after.desktop.startAtLogin).toBe(false)
    expect(after.desktop.quickAddHotkeyEnabled).toBe(false)
    expect(after.popOuts).toEqual(popOutsBefore)
    // …while a personal setting from A did arrive.
    expect(after.ui.theme).toBe('dark')
  })

  it('an AI key set on A works on B, is sealed on B, and is in no file under the share folder in plain text', async () => {
    configA.update({ ai: { ...configA.getOwn().ai, apiKey: SECRET } })
    await pushA()

    await pullB()

    expect(configB.get().ai.apiKey).toBe(SECRET)
    // Sealed on arrival: the config file on B holds the key only sealed.
    expect(fs.readFileSync(configPath(path.dirname(pathB)), 'utf8')).not.toContain(SECRET)

    const everything = (dir: string): Buffer[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        return entry.isDirectory() ? everything(full) : [fs.readFileSync(full)]
      })
    const files = everything(path.join(space(), 'Personal'))
    expect(files.length).toBeGreaterThan(0)
    for (const bytes of files) expect(bytes.includes(Buffer.from(SECRET))).toBe(false)
  })

  it('two devices changing different settings both keep their change', async () => {
    // Both PCs start from the same settings.
    await pushA()
    await pullB()

    configA.update({ ui: { theme: 'dark' } })
    configB.update({ notifications: { onBlocker: false } })
    await pushA()
    await pushB()
    await pullA()
    await pullB()

    expect(configA.get().ui.theme).toBe('dark')
    expect(configA.get().notifications.onBlocker).toBe(false)
    expect(configB.get().ui.theme).toBe('dark')
    expect(configB.get().notifications.onBlocker).toBe(false)
  })

  it('the time-block mirror runs on the PC that turned it on, and not on the other', async () => {
    const accounts = {
      list: () => [{ id: 'acc-1', capabilities: ['calendar.write'] }]
    } as unknown as ConnectedAccountsService
    const blocksA = vi.fn(() => [])
    const blocksB = vi.fn(() => [])
    const mirrorA = new TimeBlockMirror(pathA, {
      accounts,
      blocks: blocksA,
      today: () => '2026-10-24',
      projectName: () => null
    })
    const mirrorB = new TimeBlockMirror(pathB, {
      accounts,
      blocks: blocksB,
      today: () => '2026-10-24',
      projectName: () => null
    })
    try {
      await mirrorA.setTarget({ accountId: 'acc-1', remoteId: 'cal-1', name: 'Work' })
      await mirrorA.sync()
      expect(blocksA).toHaveBeenCalled()

      // The target row reaches B through the personal share, with the device that turned it on.
      for (;;) {
        const pushed = await pushChanges(
          dbA,
          personalTransport(),
          PERSONAL_PROJECT_ID,
          personalKeys(dbA)
        )
        if (pushed.written === 0) break
      }
      await pullChanges(dbB, personalTransport(), PERSONAL_PROJECT_ID, {
        projectKey: projectKeyring(dbB, PERSONAL_PROJECT_ID)
      })
      const seen = dbB.prepare('SELECT device_id FROM calendar_write_target WHERE id = 1').get() as
        { device_id: string } | undefined
      expect(seen?.device_id).toBe(
        dbA.prepare('SELECT device_id FROM calendar_write_target WHERE id = 1').pluck().get()
      )

      await mirrorB.sync()
      expect(blocksB).not.toHaveBeenCalled()
    } finally {
      mirrorA.close()
      mirrorB.close()
    }
  })
})
