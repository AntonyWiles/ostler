import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import { membershipHistory } from '../../electron/services/sync/membership-history'
import { refreshKeys, removeMember } from '../../electron/services/sync/rotation'
import {
  inviteFor,
  joinShare,
  refreshMembers,
  shareProject
} from '../../electron/services/sync/sharing'
import { refreshRoles, writeRoleChange } from '../../electron/services/sync/roles'
import { personKeys, projectKeyring } from '../../electron/services/sync/sync-keys'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const PROJECT = 'house-project'
const SETTINGS = { name: 'House', color: '#336699', notes: '', tags: [] }
const ME = (id: string, name: string) => ({
  personId: id,
  name,
  initials: name[0],
  color: '#336699'
})

describe('membership history', () => {
  const tempDir = useTempDir('ostler-membership-history-')
  let folder: string
  let dbA: Database.Database
  let dbB: Database.Database
  let dbC: Database.Database
  let shareId: string
  const opened: Database.Database[] = []
  const transport = () => new FolderTransport(folder)

  const openPc = async (name: string) => {
    const db = new Database(
      await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), name)))
    )
    attachChangeRecorder(db)
    opened.push(db)
    return db
  }

  const pull = async (db: Database.Database) => {
    await refreshKeys(db, transport(), PROJECT)
    const keyring = projectKeyring(db, PROJECT)
    await refreshMembers(db, transport(), shareId, keyring)
    await refreshRoles(db, transport(), shareId, keyring)
  }

  const memberOf = (db: Database.Database): string =>
    (db.prepare('SELECT member_id FROM sync_shares').get() as { member_id: string }).member_id

  beforeEach(async () => {
    folder = path.join(tempDir(), 'shared')
    fs.mkdirSync(folder)
    dbA = await openPc('pc-a-')
    dbB = await openPc('pc-b-')
    dbC = await openPc('pc-c-')
    await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS,
      me: ME('person-ann', 'Ann')
    })
    shareId = (dbA.prepare('SELECT share_id FROM sync_shares').get() as { share_id: string })
      .share_id
    await joinShare(dbB, transport(), inviteFor(dbA, PROJECT, 'viewer')!, {
      folder,
      memberName: 'Ben',
      me: ME('person-ben', 'Ben')
    })
    await joinShare(dbC, transport(), inviteFor(dbA, PROJECT, 'viewer')!, {
      folder,
      memberName: 'Cat',
      me: ME('person-cat', 'Cat')
    })
    await pull(dbA)
    await pull(dbB)
    await pull(dbA)
  })

  afterEach(() => {
    for (const db of opened.splice(0)) db.close()
  })

  it('lists joins, a promotion with who made it, and a removal, newest first', async () => {
    await writeRoleChange(dbA, transport(), PROJECT, personKeys(dbB).publicKey, 'editor')
    await removeMember(dbA, transport(), PROJECT, memberOf(dbC))
    await pull(dbB)

    for (const db of [dbA, dbB]) {
      const events = membershipHistory(db, shareId)
      const kinds = events.map((event) => `${event.kind}:${event.name}`)
      expect(kinds).toEqual(
        expect.arrayContaining(['joined:Ann', 'joined:Ben', 'joined:Cat', 'role-changed:Ben'])
      )
      expect(events.find((event) => event.kind === 'joined' && event.name === 'Ann')?.role).toBe(
        'owner'
      )
      const change = events.find((event) => event.kind === 'role-changed')!
      expect(change).toMatchObject({ name: 'Ben', role: 'editor', previousRole: 'viewer' })
      expect(events.filter((event) => event.kind === 'role-changed')).toHaveLength(1)
      const times = events.map((event) => event.at ?? -1)
      expect(times).toEqual([...times].sort((a, b) => b - a))
    }
    // The signer is recorded on the PC that wrote the change and on the one that read it.
    expect(membershipHistory(dbA, shareId).find((e) => e.kind === 'role-changed')?.byName).toBe(
      'Ann'
    )
    expect(membershipHistory(dbB, shareId).find((e) => e.kind === 'role-changed')?.byName).toBe(
      'Ann'
    )
    expect(
      membershipHistory(dbA, shareId).some((e) => e.kind === 'removed' && e.name === 'Cat')
    ).toBe(true)
  })
})
