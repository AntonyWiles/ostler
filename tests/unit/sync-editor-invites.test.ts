import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import {
  refreshCapabilities,
  sharedCapabilities,
  writeMyCapabilities
} from '../../electron/services/sync/capabilities'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import { refreshKeys } from '../../electron/services/sync/rotation'
import {
  inviteKeyFor,
  recordedRole,
  refreshRoles,
  roleOf,
  signGrant
} from '../../electron/services/sync/roles'
import {
  formatInvite,
  inviteFor,
  joinShare,
  parseInvite,
  refreshMembers,
  shareProject
} from '../../electron/services/sync/sharing'
import {
  identityKeys,
  keyGenerationOf,
  personKeys,
  projectKeyFor,
  projectKeyring
} from '../../electron/services/sync/sync-keys'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const PROJECT = 'house-project'
const SETTINGS = { name: 'House', color: '#336699', notes: '', tags: [] }

const MY_PERSON = (personId: string, name: string) => ({
  personId,
  name,
  initials: name[0],
  color: '#336699'
})

describe('Editors inviting people to a shared project', () => {
  const tempDir = useTempDir('ostler-editor-invites-')
  let folder: string
  let dbA: Database.Database
  let dbB: Database.Database
  let dbC: Database.Database
  let shareId: string
  const opened: Database.Database[] = []

  const transport = (): FolderTransport => new FolderTransport(folder)

  const openPc = async (name: string) => {
    const db = new Database(
      await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), name)))
    )
    attachChangeRecorder(db)
    opened.push(db)
    return db
  }

  const personOf = (db: Database.Database): string => personKeys(db).publicKey

  /** What a pull does here: key changes, members, roles, capabilities. */
  const pull = async (db: Database.Database) => {
    await refreshKeys(db, transport(), PROJECT)
    const keyring = projectKeyring(db, PROJECT)
    await refreshMembers(db, transport(), shareId, keyring)
    await refreshRoles(db, transport(), shareId, keyring)
    await refreshCapabilities(db, transport(), shareId, keyring)
  }

  const pullAll = async (dbs: Database.Database[]) => {
    for (const db of dbs) await pull(db)
  }

  const advertise = (db: Database.Database) =>
    writeMyCapabilities(db, transport(), shareId, {
      projectKey: projectKeyFor(db, PROJECT)!,
      keyGeneration: keyGenerationOf(db, PROJECT),
      privateKey: identityKeys(db).privateKey
    })

  const join = async (db: Database.Database, invite: string, name: string) =>
    joinShare(db, transport(), invite, {
      folder,
      memberName: name,
      me: MY_PERSON(`person-${name.toLowerCase()}`, name)
    })

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
      me: MY_PERSON('person-ann', 'Ann')
    })
    shareId = (dbA.prepare('SELECT share_id FROM sync_shares').get() as { share_id: string })
      .share_id
    await join(dbB, inviteFor(dbA, PROJECT, 'editor')!, 'Ben')
    await join(dbC, inviteFor(dbA, PROJECT, 'viewer')!, 'Cat')
    await pullAll([dbA, dbB, dbC, dbA])
  })

  afterEach(() => {
    for (const db of opened.splice(0)) db.close()
  })

  it("gives the joiner of an Editor's Contributor invite Contributor on every PC", async () => {
    const invite = inviteFor(dbB, PROJECT, 'contributor')
    expect(invite).not.toBeNull()
    const dbD = await openPc('pc-d-')
    await join(dbD, invite!, 'Dan')
    await pullAll([dbA, dbD, dbB, dbC])
    for (const db of [dbA, dbB, dbC, dbD])
      expect(roleOf(db, shareId, personOf(dbD))).toBe('contributor')
  })

  it('gives Viewer for an Editor grant for Owner (crafted)', async () => {
    const dbD = await openPc('pc-d-')
    const parsed = parseInvite(inviteFor(dbB, PROJECT, 'editor')!)
    const forged = formatInvite({
      ...parsed,
      grant: signGrant(dbB, shareId, 'owner'),
      invitePrivateKey: inviteKeyFor(dbB, shareId, 'owner').privateKey
    })
    await join(dbD, forged, 'Dan')
    await pullAll([dbA, dbD, dbB])
    for (const db of [dbA, dbB, dbD]) expect(roleOf(db, shareId, personOf(dbD))).toBe('viewer')
  })

  it("never accepts a Viewer's grant (crafted, signed with a Viewer's person key)", async () => {
    const dbD = await openPc('pc-d-')
    const parsed = parseInvite(inviteFor(dbA, PROJECT, 'editor')!)
    const forged = formatInvite({
      ...parsed,
      grant: signGrant(dbC, shareId, 'editor'),
      invitePrivateKey: inviteKeyFor(dbC, shareId, 'editor').privateKey
    })
    await join(dbD, forged, 'Dan')
    await pullAll([dbA, dbD, dbB, dbC])
    await pullAll([dbA, dbB, dbC])
    // Left unread for a later read, not given the role it names: no role is recorded for Dan.
    for (const db of [dbA, dbB, dbC]) {
      expect(recordedRole(db, shareId, personOf(dbD))).not.toBe('editor')
      expect(roleOf(db, shareId, personOf(dbD))).toBe('viewer')
    }
  })

  it("lists 'editor-invites' only once every member's PC advertises it, so an Editor's invite is refused until then", async () => {
    await advertise(dbA)
    await advertise(dbB)
    await pullAll([dbA, dbB, dbC])
    // Cat's PC (an older Ostler) has advertised nothing.
    expect(sharedCapabilities(dbA, shareId)).not.toContain('editor-invites')
    expect(sharedCapabilities(dbB, shareId)).not.toContain('editor-invites')
    await advertise(dbC)
    await pullAll([dbA, dbB, dbC])
    expect(sharedCapabilities(dbB, shareId)).toContain('editor-invites')
  })
})
