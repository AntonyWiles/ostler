import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConnectedAccount } from '@shared/ostler-api'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { DriveChangesPoller } from '../../electron/services/sync/drive-changes'
import { DRIVE_FOLDER_MIME } from '../../electron/services/sync/drive-client'
import { DriveSyncSettings } from '../../electron/services/sync/drive-sync-settings'
import { DriveTransport, pollerSubscription } from '../../electron/services/sync/drive-transport'
import type { LibraryFileStore } from '../../electron/services/sync/library-files'
import { SharingError } from '../../electron/services/sync/sharing'
import { SyncService } from '../../electron/services/sync/sync-service'
import {
  countTasks,
  joinErrorKey,
  PhoneJoinError,
  PhoneSync,
  PUSH_DEBOUNCE_MS
} from '../../mobile/src/sync/phone-sync'
import { createMigratedDatabase } from '../helpers/database'
import { FakeDrive } from '../helpers/fake-drive'
import { useTempDir } from '../helpers/temp-dir'

const PROJECT = 'house-project'
const SETTINGS = { name: 'House', color: '#336699', notes: '', tags: [] }
const noLibrary: LibraryFileStore = {
  syncedOriginal: () => null,
  receiveSyncedOriginal: async () => undefined
}
const googleAccount = { id: 'account-1', provider: 'google' } as ConnectedAccount

describe('the phone joins a shared project and syncs it both ways (mobile plan, prompt 09)', () => {
  const tempDir = useTempDir('ostler-phone-sync-')
  let drive: FakeDrive
  const closers: (() => unknown)[] = []

  beforeEach(() => {
    drive = new FakeDrive()
    drive.entries.set('root', {
      id: 'root',
      name: 'My Drive',
      mimeType: DRIVE_FOLDER_MIME,
      createdTime: '2026-01-01T00:00:00.000Z',
      parent: '',
      bytes: null
    })
  })

  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close()
  })

  /** The desktop: a `SyncService` through the fake Drive, plus the connection the planning code writes with. */
  const desktop = async (name: string) => {
    const databasePath = await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), name)))
    const settings = new DriveSyncSettings({
      accountsWithDrive: () => [googleAccount],
      call: () => Promise.reject(new Error('unused')),
      client: drive
    })
    const service = new SyncService({
      databasePath,
      library: noLibrary,
      projectSettings: () => SETTINGS,
      onProjectChanged: () => undefined,
      onStateChanged: () => undefined,
      memberName: () => name,
      logError: (message, error) => {
        throw new Error(`${message} ${String(error)}`)
      },
      openDrive: (place: string) => settings.open(place),
      pushCheckMs: 60_000,
      scanIntervalMs: 60_000
    })
    const db = new Database(databasePath)
    attachChangeRecorder(db)
    closers.push(async () => {
      await service.stop()
      db.close()
    })
    return { settings, service, db }
  }

  /** The phone: a `PhoneSync` on its own migrated database, one poller, no timers. */
  const phone = async () => {
    const db = new Database(
      await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), 'phone-')))
    )
    const poller = new DriveChangesPoller(drive, {
      setTimer: () => 0,
      clearTimer: () => undefined
    })
    let kicks = 0
    const logged: string[] = []
    const timers: { fn: () => void; ms: number }[] = []
    const sync = new PhoneSync({
      db,
      openTransport: (place) =>
        new DriveTransport(drive, place, { subscribe: pollerSubscription(poller) }),
      poller: {
        kick: () => {
          kicks += 1
          poller.kick()
        }
      },
      now: () => Date.now(),
      deviceName: 'Test phone',
      log: (message, error) => logged.push(`${message} ${String(error)}`),
      setTimer: (fn, ms) => {
        timers.push({ fn, ms })
        return timers.length
      },
      clearTimer: () => undefined
    })
    closers.push(async () => {
      await sync.dispose()
      db.close()
    })
    return { sync, db, kicks: () => kicks, logged, timers }
  }

  const insertItem = (db: Database.Database, id: string, title: string) =>
    db
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
      )
      .run(id, PROJECT, title)
  const titleOf = (db: Database.Database, id: string): string | undefined =>
    (
      db.prepare('SELECT title FROM planning_work_items WHERE id = ?').get(id) as
        { title: string } | undefined
    )?.title
  const bodyOf = (db: Database.Database, id: string): string | undefined =>
    (
      db.prepare('SELECT body FROM planning_comments WHERE id = ?').get(id) as
        { body: string } | undefined
    )?.body
  /** A comment, written the way the desktop's planning code writes one (planning-activity.ts). */
  const insertComment = (db: Database.Database, id: string, body: string) =>
    db
      .prepare(
        `INSERT INTO planning_comments
           (id, project_id, work_item_id, author_person_id, author_kind, body, created_at, updated_at, deleted_at, rule_name)
         VALUES (?, ?, 'item-1', ?, 'human', ?, 1, 1, NULL, NULL)`
      )
      .run(id, PROJECT, 'person-phone', body)

  /** The desktop shares a project with two tasks through Drive; returns its invite. */
  const shareFromDesktop = async () => {
    const ann = await desktop('ann-')
    ann.service.start()
    insertItem(ann.db, 'item-1', 'Paint hall')
    insertItem(ann.db, 'item-2', 'Fix gate')
    const place = await ann.settings.newProjectFolder(SETTINGS.name)
    await ann.service.share(PROJECT, place)
    return { ann, invite: ann.service.invite(PROJECT)! }
  }

  it('joins from the invite and has as many tasks as the desktop', async () => {
    const { ann, invite } = await shareFromDesktop()
    const mobile = await phone()
    mobile.sync.start()

    const joined = await mobile.sync.join(invite)
    expect(joined.projectId).toBe(PROJECT)
    expect(joined.project).toEqual(SETTINGS)
    expect(countTasks(mobile.db, PROJECT)).toBe(countTasks(ann.db, PROJECT))
    expect(countTasks(mobile.db, PROJECT)).toBe(2)
    expect(mobile.sync.shares().map((share) => share.projectId)).toEqual([PROJECT])
    // Nothing that was applied from the desktop is captured as the phone's own change.
    expect(mobile.db.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get()).toEqual({ n: 0 })
    expect(mobile.logged).toEqual([])
  })

  it('brings a task added on the desktop to the phone', async () => {
    const { ann, invite } = await shareFromDesktop()
    const mobile = await phone()
    mobile.sync.start()
    await mobile.sync.join(invite)

    insertItem(ann.db, 'item-3', 'Mow lawn')
    ann.db
      .prepare('UPDATE planning_work_items SET title = ? WHERE id = ?')
      .run('Paint the hall', 'item-1')
    await ann.service.syncNow(PROJECT)
    await mobile.sync.syncNow(PROJECT)

    expect(titleOf(mobile.db, 'item-3')).toBe('Mow lawn')
    expect(titleOf(mobile.db, 'item-1')).toBe('Paint the hall')
    expect(countTasks(mobile.db, PROJECT)).toBe(countTasks(ann.db, PROJECT))
    expect(mobile.logged).toEqual([])
  })

  it('sends a comment written on the phone to the desktop', async () => {
    const { ann, invite } = await shareFromDesktop()
    const mobile = await phone()
    mobile.sync.start()
    await mobile.sync.join(invite)

    insertComment(mobile.db, 'comment-1', 'Looks good from the phone')
    const queued = mobile.db
      .prepare('SELECT stamp, actor_kind FROM sync_outbox WHERE table_name = ?')
      .all('planning_comments') as { stamp: string; actor_kind: string }[]
    expect(queued).toHaveLength(1)
    // A stamp as the desktop's clock writes them: wall ms, counter, this phone's device id.
    expect(queued[0].stamp).toMatch(/^\d{15}-\d{6}-\S+$/)
    const device = (
      mobile.db.prepare('SELECT device_id FROM sync_shares').get() as { device_id: string }
    ).device_id
    expect(queued[0].stamp.endsWith(`-${device}`)).toBe(true)

    await mobile.sync.syncNow(PROJECT)
    await ann.service.syncNow(PROJECT)
    expect(bodyOf(ann.db, 'comment-1')).toBe('Looks good from the phone')
    // Sent, so the phone's outbox is empty again.
    expect(mobile.db.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get()).toEqual({ n: 0 })
    expect(mobile.kicks()).toBeGreaterThan(0)
    expect(mobile.logged).toEqual([])
  })

  it('stamps a phone edit after the desktop edit it saw, and keeps the later one', async () => {
    const { ann, invite } = await shareFromDesktop()
    const mobile = await phone()
    mobile.sync.start()
    await mobile.sync.join(invite)

    ann.db
      .prepare('UPDATE planning_work_items SET title = ? WHERE id = ?')
      .run('Desktop title', 'item-1')
    await ann.service.syncNow(PROJECT)
    await mobile.sync.syncNow(PROJECT)
    mobile.db
      .prepare('UPDATE planning_work_items SET title = ? WHERE id = ?')
      .run('Phone title', 'item-1')
    await mobile.sync.syncNow(PROJECT)
    await ann.service.syncNow(PROJECT)

    expect(titleOf(ann.db, 'item-1')).toBe('Phone title')
    expect(titleOf(mobile.db, 'item-1')).toBe('Phone title')
  })

  it('pushes about 2 seconds after a local write, once for a burst', async () => {
    const { invite } = await shareFromDesktop()
    const mobile = await phone()
    mobile.sync.start()
    await mobile.sync.join(invite)
    mobile.timers.length = 0

    insertComment(mobile.db, 'comment-1', 'one')
    mobile.sync.noteLocalWrite()
    insertComment(mobile.db, 'comment-2', 'two')
    mobile.sync.noteLocalWrite()
    expect(mobile.timers.map((timer) => timer.ms)).toEqual([PUSH_DEBOUNCE_MS, PUSH_DEBOUNCE_MS])
    expect(PUSH_DEBOUNCE_MS).toBe(2000)
    mobile.timers[mobile.timers.length - 1].fn()
    await mobile.sync.syncNow(PROJECT)
    expect(mobile.db.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get()).toEqual({ n: 0 })
  })

  it('refuses an invite for a folder on a PC, with a clear message', async () => {
    const ann = await desktop('ann-')
    ann.service.start()
    insertItem(ann.db, 'item-1', 'Paint hall')
    const folder = fs.mkdtempSync(path.join(tempDir(), 'shared-'))
    await ann.service.share(PROJECT, folder)
    const invite = ann.service.invite(PROJECT)!

    const mobile = await phone()
    mobile.sync.start()
    const failure = await mobile.sync.join(invite).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(PhoneJoinError)
    expect(joinErrorKey(failure)).toBe('mobile:join.errors.notDriveInvite')
    expect(mobile.db.prepare('SELECT COUNT(*) AS n FROM sync_shares').get()).toEqual({ n: 0 })
  })

  it('refuses text that is not an invite, and an invite already joined', async () => {
    const { invite } = await shareFromDesktop()
    const mobile = await phone()
    mobile.sync.start()
    const bad = await mobile.sync.join('hello').catch((error: unknown) => error)
    expect(bad).toBeInstanceOf(SharingError)
    expect(joinErrorKey(bad)).toBe('mobile:join.errors.notAnInvite')

    await mobile.sync.join(invite)
    const again = await mobile.sync.join(invite).catch((error: unknown) => error)
    expect(joinErrorKey(again)).toBe('mobile:join.errors.alreadyShared')
  })

  it('opens the shares it already has when it starts again', async () => {
    const { ann, invite } = await shareFromDesktop()
    const mobile = await phone()
    mobile.sync.start()
    await mobile.sync.join(invite)
    await mobile.sync.stop()

    insertItem(ann.db, 'item-3', 'Mow lawn')
    await ann.service.syncNow(PROJECT)
    mobile.sync.start()
    await mobile.sync.syncNow(PROJECT)
    expect(titleOf(mobile.db, 'item-3')).toBe('Mow lawn')
    expect(mobile.sync.shares()[0].taskCount).toBe(3)
  })
})
