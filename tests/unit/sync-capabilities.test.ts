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
import { sealEnvelope, type EnvelopeKind } from '../../electron/services/sync/envelope'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import { writeLeftNote, refreshLeft } from '../../electron/services/sync/leaving'
import { refreshKeys } from '../../electron/services/sync/rotation'
import { localStamp } from '../../electron/services/sync/capture'
import { assignGrantedRole, refreshRoles, roleOf } from '../../electron/services/sync/roles'
import {
  inviteFor,
  joinShare,
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

describe('member capabilities in a shared project', () => {
  const tempDir = useTempDir('ostler-sync-caps-')
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

  const sealKeys = (db: Database.Database) => ({
    projectKey: projectKeyFor(db, PROJECT)!,
    keyGeneration: keyGenerationOf(db, PROJECT),
    privateKey: identityKeys(db).privateKey
  })

  const memberOf = (db: Database.Database): string =>
    (db.prepare('SELECT member_id FROM sync_shares').get() as { member_id: string }).member_id

  /** What a pull does here: key changes, members, roles, left notes, capabilities. */
  const pull = async (db: Database.Database) => {
    await refreshKeys(db, transport(), PROJECT)
    const keyring = projectKeyring(db, PROJECT)
    await refreshMembers(db, transport(), shareId, keyring)
    const roles = await refreshRoles(db, transport(), shareId, keyring)
    await refreshLeft(db, transport(), shareId, keyring)
    await refreshCapabilities(db, transport(), shareId, keyring)
    return roles
  }

  const advertise = (db: Database.Database) =>
    writeMyCapabilities(db, transport(), shareId, sealKeys(db))

  const pullAll = async () => {
    for (const db of [dbA, dbB, dbC]) await pull(db)
  }

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
    await joinShare(dbB, transport(), inviteFor(dbA, PROJECT, 'editor')!, {
      folder,
      memberName: 'Ben',
      me: MY_PERSON('person-ben', 'Ben')
    })
    await pull(dbA)
    await pull(dbB)
    await pull(dbA)
  })

  afterEach(() => {
    for (const db of opened.splice(0)) db.close()
  })

  it('lists a capability both PCs advertise (a)', async () => {
    await advertise(dbA)
    await advertise(dbB)
    await pull(dbA)
    await pull(dbB)
    expect(sharedCapabilities(dbA, shareId)).toContain('contributor-role')
    expect(sharedCapabilities(dbB, shareId)).toContain('contributor-role')
  })

  it('writing the note twice is fine and ignored (a)', async () => {
    await advertise(dbA)
    await expect(advertise(dbA)).resolves.toBeUndefined()
  })

  it('empties the list while a PC that advertises nothing is in the share, and refills it when that PC leaves (b, c)', async () => {
    await advertise(dbA)
    await advertise(dbB)
    await joinShare(dbC, transport(), inviteFor(dbA, PROJECT, 'viewer')!, {
      folder,
      memberName: 'Cat',
      me: MY_PERSON('person-cat', 'Cat')
    })
    await pullAll()
    await pullAll()
    for (const db of [dbA, dbB, dbC]) expect(sharedCapabilities(db, shareId)).toEqual([])

    await writeLeftNote(transport(), { shareId, memberId: memberOf(dbC) }, sealKeys(dbC))
    await pull(dbA)
    await pull(dbB)
    expect(sharedCapabilities(dbA, shareId)).toContain('contributor-role')
    expect(sharedCapabilities(dbB, shareId)).toContain('contributor-role')
  })

  it('treats a role file naming an unknown role as refused, leaving the person as they were (d)', async () => {
    await advertise(dbA)
    const before = roleOf(dbB, shareId, personKeys(dbB).publicKey)
    expect(before).toBe('editor')
    // The same file writeRoleChange writes, with a role this code does not know.
    const kind: EnvelopeKind = {
      magic: Buffer.from('OSTLERRL', 'ascii'),
      version: 1,
      maxBytes: 64 * 1024,
      refuse: (reason) => {
        throw new Error(reason)
      }
    }
    const share = dbA.prepare('SELECT device_id, member_id FROM sync_shares').get() as {
      device_id: string
      member_id: string
    }
    const bytes = sealEnvelope(
      kind,
      {
        formatVersion: 1,
        shareId,
        memberId: share.member_id,
        publicKey: identityKeys(dbA).publicKey
      },
      {
        personPublicKey: personKeys(dbB).publicKey,
        role: 'boss',
        previousRole: 'editor',
        cutoffs: {}
      },
      sealKeys(dbA)
    )
    await transport().writeOnce(`roles/${localStamp(share.device_id)}.ostlerrole`, bytes)

    const result = await pull(dbB)
    expect(roleOf(dbB, shareId, personKeys(dbB).publicKey)).toBe('editor')
    expect(result.problems.map((problem) => problem.reason)).toEqual(['bad-role'])
    const row = dbB
      .prepare('SELECT applied, role FROM sync_role_files WHERE share_id = ? ORDER BY stamp DESC')
      .get(shareId) as { applied: number; role: string | null }
    expect(row.applied).toBe(0)
    expect(row.role).toBeNull()
  })

  it('gives a joiner whose grant names an unknown role the Viewer role (e)', () => {
    const joiner = personKeys(dbB).publicKey
    const owner = personKeys(dbA).publicKey
    // A fresh share with no role on record for this person.
    dbB.prepare('DELETE FROM sync_roles WHERE person_public_key = ?').run(joiner)
    assignGrantedRole(
      dbB,
      shareId,
      joiner,
      { role: 'contributor', inviteId: 'invite', signedBy: owner, signature: 'AAAA' },
      null
    )
    expect(roleOf(dbB, shareId, joiner)).toBe('viewer')
  })
})
