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
import { MIGRATIONS } from '../../electron/services/database/migrations'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import { refreshKeys, removeMember } from '../../electron/services/sync/rotation'
import { openEnvelope } from '../../electron/services/sync/envelope'
import {
  formatInvite,
  inviteFor,
  joinShare,
  MEMBER_FILE,
  parseInvite,
  refreshMembers,
  shareProject
} from '../../electron/services/sync/sharing'
import {
  assertOwner,
  assignGrantedRole,
  ensureRoleFiles,
  myRoleOf,
  refreshRoles,
  roleAtSequence,
  roleOf,
  writeRoleChange
} from '../../electron/services/sync/roles'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import { writeSnapshot } from '../../electron/services/sync/snapshots'
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

/** This PC's Me person, sent with its member file (sharing.ts MePerson). */
const MY_PERSON = (personId: string, name: string) => ({
  personId,
  name,
  initials: name[0],
  color: '#336699'
})

describe('roles in a shared project (people and devices, D1, D6 to D8)', () => {
  const tempDir = useTempDir('ostler-sync-roles-')
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

  const deviceOf = (db: Database.Database): string =>
    (db.prepare('SELECT device_id FROM sync_shares').get() as { device_id: string }).device_id

  const insertItem = (db: Database.Database, id: string, title: string) =>
    db
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
      )
      .run(id, PROJECT, title)

  const insertComment = (db: Database.Database, id: string, authorPersonId: string, body: string) =>
    db
      .prepare(
        `INSERT INTO planning_comments (id, project_id, work_item_id, author_person_id, author_kind, body, created_at, updated_at)
         VALUES (?, ?, 'item-1', ?, 'human', ?, 1, 1)`
      )
      .run(id, PROJECT, authorPersonId, body)

  const rename = (db: Database.Database, id: string, title: string) =>
    db.prepare('UPDATE planning_work_items SET title = ? WHERE id = ?').run(title, id)

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

  const push = (db: Database.Database) =>
    pushChanges(db, transport(), PROJECT, {
      projectKey: projectKeyFor(db, PROJECT)!,
      keyGeneration: keyGenerationOf(db, PROJECT),
      privateKey: identityKeys(db).privateKey
    })

  /** What a pull does: key changes, members, roles, then changes. */
  const pull = async (db: Database.Database, through: FolderTransport = transport()) => {
    await refreshKeys(db, through, PROJECT)
    const keyring = projectKeyring(db, PROJECT)
    await refreshMembers(db, through, shareId, keyring)
    const roles = await refreshRoles(db, through, shareId, keyring)
    const changes = await pullChanges(db, through, PROJECT, { projectKey: keyring })
    return { roles, changes }
  }

  /** Makes the share look as it did before roles: no role files, everyone an Owner (migration 0073). */
  const makePreRoles = () => {
    fs.rmSync(path.join(folder, 'roles'), { recursive: true, force: true })
    const people = [dbA, dbB, dbC].map(personOf)
    for (const db of [dbA, dbB, dbC]) {
      db.prepare('DELETE FROM sync_role_files').run()
      db.prepare('DELETE FROM sync_roles').run()
      for (const person of people) {
        db.prepare(
          `INSERT INTO sync_roles (share_id, person_public_key, role, since_stamp, granted_by, cutoffs)
           VALUES (?, ?, 'owner', '0', NULL, NULL)`
        ).run(shareId, person)
      }
      db.prepare("UPDATE sync_shares SET my_role = 'owner'").run()
    }
  }

  const roleIn = (db: Database.Database, person: string) => roleOf(db, shareId, person)

  const memberOf = (db: Database.Database): string =>
    (db.prepare('SELECT member_id FROM sync_shares').get() as { member_id: string }).member_id

  const removedAt = (db: Database.Database, memberId: string): number | null =>
    (
      db
        .prepare('SELECT removed_at FROM sync_members WHERE share_id = ? AND member_id = ?')
        .get(shareId, memberId) as { removed_at: number | null }
    ).removed_at

  beforeEach(async () => {
    folder = path.join(tempDir(), 'shared')
    fs.mkdirSync(folder)
    dbA = await openPc('pc-a-')
    dbB = await openPc('pc-b-')
    dbC = await openPc('pc-c-')
    insertItem(dbA, 'item-1', 'Paint hall')
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
    await joinShare(dbC, transport(), inviteFor(dbA, PROJECT, 'viewer')!, {
      folder,
      memberName: 'Cat',
      me: MY_PERSON('person-cat', 'Cat')
    })
    await pull(dbA)
    await pull(dbB)
    await pull(dbC)
    await pull(dbA)
  })

  afterEach(() => {
    for (const db of opened.splice(0)) db.close()
  })

  it('gives every PC the same three roles: the sharer Owner, the Editor Editor, the Viewer Viewer (a)', async () => {
    for (const db of [dbA, dbB, dbC]) {
      expect(roleIn(db, personOf(dbA))).toBe('owner')
      expect(roleIn(db, personOf(dbB))).toBe('editor')
      expect(roleIn(db, personOf(dbC))).toBe('viewer')
    }
  })

  it("refuses a Viewer's task edit and an edit to someone else's comment on the Viewer's PC, and syncs its own comment (b)", async () => {
    insertComment(dbB, 'b-1', 'person-ben', 'Ben says hello')
    await push(dbB)
    await pull(dbA)
    await pull(dbC)

    // The Viewer's PC refuses the edit itself (people and devices, D9), so nothing is sent.
    // Cat is Me on her own PC: the guard lets a Viewer write their own comments by `people.is_me`.
    dbC.prepare("UPDATE people SET is_me = 1 WHERE id = 'person-cat'").run()
    expect(() => rename(dbC, 'item-1', 'Paint hall blue')).toThrow(/ostler:read-only/)
    await push(dbC)
    await pull(dbA)
    expect(titleOf(dbA, 'item-1')).toBe('Paint hall')

    insertComment(dbC, 'c-1', 'person-cat', 'Looks fine')
    await push(dbC)
    await pull(dbA)
    expect(bodyOf(dbA, 'c-1')).toBe('Looks fine')

    expect(() =>
      dbC.prepare("UPDATE planning_comments SET body = 'hacked' WHERE id = 'b-1'").run()
    ).toThrow(/ostler:read-only/)
    await pull(dbA)
    expect(bodyOf(dbA, 'b-1')).toBe('Ben says hello')
  })

  it("applies a demoted person's edits from before the change and skips the ones after it (c)", async () => {
    rename(dbB, 'item-1', 'Paint the hall')
    await push(dbB)
    await pull(dbA)
    expect(titleOf(dbA, 'item-1')).toBe('Paint the hall')

    await writeRoleChange(dbA, transport(), PROJECT, personOf(dbB), 'viewer')
    expect(roleIn(dbA, personOf(dbB))).toBe('viewer')

    rename(dbB, 'item-1', 'Paint the hall white')
    await push(dbB)
    const atA = await pull(dbA)
    expect(atA.changes.problems).toEqual([expect.objectContaining({ reason: 'not-allowed' })])
    expect(titleOf(dbA, 'item-1')).toBe('Paint the hall')

    // C has not seen the change: it reads B's first file as Editor and the second as Viewer.
    await pull(dbC)
    expect(roleIn(dbC, personOf(dbB))).toBe('viewer')
    expect(titleOf(dbC, 'item-1')).toBe('Paint the hall')
    expect(roleAtSequence(dbC, shareId, personOf(dbB), deviceOf(dbB), 1)).toBe('editor')
    expect(roleAtSequence(dbC, shareId, personOf(dbB), deviceOf(dbB), 2)).toBe('viewer')
  })

  it('refuses an Editor changing a role, or removing anyone, and a Viewer inviting (d)', async () => {
    expect(inviteFor(dbB, PROJECT, 'editor')).not.toBeNull()
    expect(inviteFor(dbC, PROJECT, 'editor')).toBeNull()
    expect(() => assertOwner(dbB, PROJECT)).toThrow('not-an-owner')
    await expect(
      writeRoleChange(dbB, transport(), PROJECT, personOf(dbC), 'editor')
    ).rejects.toThrow('not-an-owner')
    expect(roleIn(dbB, personOf(dbC))).toBe('viewer')
  })

  it('gives a Viewer when a grant is tampered with (role changed) or its signature is wrong (e)', async () => {
    const parsed = parseInvite(inviteFor(dbA, PROJECT, 'editor')!)
    const forged = formatInvite({ ...parsed, grant: { ...parsed.grant!, role: 'owner' } })
    const badSignature = formatInvite({
      ...parsed,
      grant: { ...parsed.grant!, signature: Buffer.alloc(64).toString('base64') }
    })
    const dbD = await openPc('pc-d-')
    const dbE = await openPc('pc-e-')
    await joinShare(dbD, transport(), forged, { folder, memberName: 'Dan' })
    await joinShare(dbE, transport(), badSignature, { folder, memberName: 'Eve' })
    await pull(dbA)

    const rowOf = (db: Database.Database, person: string) =>
      (
        db
          .prepare('SELECT role FROM sync_roles WHERE share_id = ? AND person_public_key = ?')
          .get(shareId, person) as { role: string } | undefined
      )?.role
    expect(rowOf(dbD, personOf(dbD))).toBe('viewer')
    expect(rowOf(dbE, personOf(dbE))).toBe('viewer')
    expect(rowOf(dbA, personOf(dbD))).toBe('viewer')
    expect(rowOf(dbA, personOf(dbE))).toBe('viewer')
  })

  it('refuses to demote the last Owner (f)', async () => {
    await expect(
      writeRoleChange(dbA, transport(), PROJECT, personOf(dbA), 'editor')
    ).rejects.toThrow('last-owner')
    expect(roleIn(dbA, personOf(dbA))).toBe('owner')
  })

  it('treats every member of a share from before roles as Owner (g)', () => {
    const legacy = new Database(':memory:')
    try {
      for (const migration of MIGRATIONS.filter((m) => m.version <= 72)) migration.up(legacy)
      legacy.exec(`
        INSERT INTO sync_members (share_id, member_id, name, public_key, joined_at, person_public_key) VALUES
          ('old', 'm1', 'Ann', 'dev-1', 1, 'person-ann'),
          ('old', 'm2', 'Ben', 'dev-2', 2, 'person-ben');
      `)
      MIGRATIONS.find((m) => m.version === 73)!.up(legacy)

      expect(roleOf(legacy, 'old', 'person-ann')).toBe('owner')
      expect(roleOf(legacy, 'old', 'person-ben')).toBe('owner')
      expect(roleAtSequence(legacy, 'old', 'person-ben', 'dev-2', 99)).toBe('owner')
      expect(
        (legacy.prepare('SELECT COUNT(*) AS n FROM sync_role_files').get() as { n: number }).n
      ).toBe(0)
    } finally {
      legacy.close()
    }
  })

  it('refuses a key change from a member no one has read, and the Owner stays (F1 i)', async () => {
    const dbD = await openPc('pc-d-')
    await joinShare(dbD, transport(), inviteFor(dbA, PROJECT, 'viewer')!, {
      folder,
      memberName: 'Dan'
    })
    // The Viewer hides who they are, then signs a key change removing the Owner.
    fs.rmSync(path.join(folder, 'members', `${memberOf(dbD)}.ostlermember`))
    await removeMember(dbD, transport(), PROJECT, memberOf(dbA))

    const atB = await refreshKeys(dbB, transport(), PROJECT)
    expect(atB.read).toBe(0)
    expect(atB.problems).toEqual([expect.objectContaining({ reason: 'unknown-signer' })])
    expect(removedAt(dbB, memberOf(dbA))).toBeNull()
    expect(keyGenerationOf(dbB, PROJECT)).toBe(0)
  })

  it('refuses a key change from a known Viewer (F1)', async () => {
    await removeMember(dbC, transport(), PROJECT, memberOf(dbA))
    const atB = await refreshKeys(dbB, transport(), PROJECT)
    expect(atB.problems).toEqual([expect.objectContaining({ reason: 'not-an-owner' })])
    expect(removedAt(dbB, memberOf(dbA))).toBeNull()
  })

  it("applies the Owner's removal on a PC that reads it in the normal order (F1 ii)", async () => {
    const dbE = await openPc('pc-e-')
    await joinShare(dbE, transport(), inviteFor(dbA, PROJECT, 'editor')!, {
      folder,
      memberName: 'Eve'
    })
    // A reads E's member file first, so E is given the new key.
    await pull(dbA)
    await removeMember(dbA, transport(), PROJECT, memberOf(dbC))
    await pull(dbE)
    expect(removedAt(dbE, memberOf(dbC))).not.toBeNull()
    expect(keyGenerationOf(dbE, PROJECT)).toBe(1)
  })

  it('lets a PC that joins later read a removal by an Owner made after the founder (F1)', async () => {
    await writeRoleChange(dbA, transport(), PROJECT, personOf(dbB), 'owner')
    await pull(dbB)
    await removeMember(dbB, transport(), PROJECT, memberOf(dbC))
    // As the service does after a removal: a snapshot with the new key.
    await writeSnapshot(
      dbB,
      transport(),
      PROJECT,
      {
        projectKey: projectKeyFor(dbB, PROJECT)!,
        keyGeneration: keyGenerationOf(dbB, PROJECT),
        privateKey: identityKeys(dbB).privateKey
      },
      SETTINGS
    )
    await pull(dbA)
    expect(removedAt(dbA, memberOf(dbC))).not.toBeNull()

    const dbD = await openPc('pc-d-')
    await joinShare(dbD, transport(), inviteFor(dbA, PROJECT, 'editor')!, {
      folder,
      memberName: 'Dan'
    })
    expect(keyGenerationOf(dbD, PROJECT)).toBe(1)
    expect(removedAt(dbD, memberOf(dbC))).not.toBeNull()
    expect(roleIn(dbD, personOf(dbB))).toBe('owner')
    expect(roleIn(dbD, personOf(dbD))).toBe('editor')
  })

  it("keeps a Viewer who copies the Editor's grant from their member file a Viewer (F2 i)", async () => {
    // What Cat, a Viewer, can read: Ben's member file, with his grant and his proof.
    const bytes = fs.readFileSync(path.join(folder, 'members', `${memberOf(dbB)}.ostlermember`))
    let named: { memberId: string; publicKey: string } | null = null
    const { payload } = openEnvelope(
      MEMBER_FILE,
      bytes,
      { projectKey: projectKeyring(dbC, PROJECT), publicKeyFor: () => named?.publicKey ?? null },
      (raw) => (named = raw as { memberId: string; publicKey: string })
    )
    const { grant, grantProof } = payload as { grant: { role: string }; grantProof: string }
    expect(grant.role).toBe('editor')

    // Joining with the Viewer invite, its grant swapped for Ben's.
    const viewerInvite = parseInvite(inviteFor(dbA, PROJECT, 'viewer')!)
    const copied = formatInvite({ ...viewerInvite, grant: grant as never })
    const dbD = await openPc('pc-d-')
    await joinShare(dbD, transport(), copied, { folder, memberName: 'Dan' })
    await pull(dbA)
    expect(roleIn(dbA, personOf(dbD))).toBe('viewer')

    // Ben's proof copied too: it names Ben's person, so it proves nothing for anyone else.
    const dbE = await openPc('pc-e-')
    assignGrantedRole(dbA, shareId, personOf(dbE), grant, grantProof)
    expect(roleIn(dbA, personOf(dbE))).toBe('viewer')

    // The invite private keys never reach the folder.
    const secrets = ['editor', 'viewer'].map(
      (role) => parseInvite(inviteFor(dbA, PROJECT, role as 'editor' | 'viewer')!).invitePrivateKey!
    )
    const files = fs.readdirSync(folder, { recursive: true, withFileTypes: true })
    for (const file of files.filter((entry) => entry.isFile())) {
      const text = fs.readFileSync(path.join(file.parentPath, file.name)).toString('latin1')
      for (const secret of secrets) expect(text).not.toContain(secret)
    }
  })

  it('makes two people who join with the same Editor invite both Editors (F2 ii)', async () => {
    const invite = inviteFor(dbA, PROJECT, 'editor')!
    const dbD = await openPc('pc-d-')
    const dbE = await openPc('pc-e-')
    await joinShare(dbD, transport(), invite, { folder, memberName: 'Dan' })
    await joinShare(dbE, transport(), invite, { folder, memberName: 'Eve' })
    await pull(dbA)
    expect(roleIn(dbA, personOf(dbD))).toBe('editor')
    expect(roleIn(dbA, personOf(dbE))).toBe('editor')
  })

  it("lets a new joiner of a share from before roles, after the Owner's next pull, be an Editor and see the Owners (F3 i)", async () => {
    makePreRoles()
    await ensureRoleFiles(dbA, transport(), PROJECT)
    const dbD = await openPc('pc-d-')
    await joinShare(dbD, transport(), inviteFor(dbA, PROJECT, 'editor')!, {
      folder,
      memberName: 'Dan'
    })
    for (const db of [dbA, dbB, dbC]) expect(roleIn(dbD, personOf(db))).toBe('owner')
    expect(roleIn(dbD, personOf(dbD))).toBe('editor')
    expect(myRoleOf(dbD, PROJECT)).toBe('editor')

    rename(dbA, 'item-1', 'Paint hall green')
    await push(dbA)
    await pull(dbD)
    expect(titleOf(dbD, 'item-1')).toBe('Paint hall green')
  })

  it('writes the role files of a share from before roles only once (F3)', async () => {
    makePreRoles()
    await ensureRoleFiles(dbA, transport(), PROJECT)
    await ensureRoleFiles(dbB, transport(), PROJECT)
    expect(fs.readdirSync(path.join(folder, 'roles'))).toHaveLength(3)
  })

  it('takes the Owners of a share from before roles for a joiner with an old invite (F3 ii)', async () => {
    makePreRoles()
    await ensureRoleFiles(dbA, transport(), PROJECT)
    const parsed = parseInvite(inviteFor(dbA, PROJECT, 'editor')!)
    const old = formatInvite({
      ...parsed,
      founder: undefined,
      grant: undefined,
      invitePrivateKey: undefined
    })
    const dbD = await openPc('pc-d-')
    await joinShare(dbD, transport(), old, { folder, memberName: 'Dan' })
    for (const db of [dbA, dbB, dbC]) expect(roleIn(dbD, personOf(db))).toBe('owner')
    expect(roleIn(dbD, personOf(dbD))).toBe('viewer')
  })

  it("applies a role file that arrives before its signer's promotion on a later pull (F3 iii)", async () => {
    await writeRoleChange(dbA, transport(), PROJECT, personOf(dbB), 'owner')
    await pull(dbB)
    await writeRoleChange(dbB, transport(), PROJECT, personOf(dbC), 'editor')
    const roleFiles = fs.readdirSync(path.join(folder, 'roles')).sort()
    expect(roleFiles).toHaveLength(3)

    // A second copy of the folder that has only Ben's role file so far.
    const later = path.join(tempDir(), 'later')
    fs.cpSync(folder, later, { recursive: true })
    for (const file of roleFiles.slice(0, -1)) fs.rmSync(path.join(later, 'roles', file))
    const through = new FolderTransport(later)
    const dbE = await openPc('pc-e-')
    await joinShare(dbE, through, inviteFor(dbA, PROJECT, 'editor')!, {
      folder: later,
      memberName: 'Eve'
    })
    expect(roleIn(dbE, personOf(dbC))).toBe('viewer')

    fs.cpSync(path.join(folder, 'roles'), path.join(later, 'roles'), { recursive: true })
    await pull(dbE, through)
    expect(roleIn(dbE, personOf(dbB))).toBe('owner')
    expect(roleIn(dbE, personOf(dbC))).toBe('editor')
  })

  it('still joins from an invite from before roles, with no founder and no grant (h)', async () => {
    const parsed = parseInvite(inviteFor(dbA, PROJECT, 'editor')!)
    const old = formatInvite({ ...parsed, founder: undefined, grant: undefined })
    const dbD = await openPc('pc-d-')
    const joined = await joinShare(dbD, transport(), old, { folder, memberName: 'Dan' })

    expect(joined.projectId).toBe(PROJECT)
    expect(titleOf(dbD, 'item-1')).toBe('Paint hall')
    await pull(dbA)
    expect(roleIn(dbA, personOf(dbD))).toBe('viewer')
  })
  it('gives a joiner with a Contributor invite the Contributor role on every PC (Contributor)', async () => {
    const dbD = await openPc('pc-d-')
    await joinShare(dbD, transport(), inviteFor(dbA, PROJECT, 'contributor')!, {
      folder,
      memberName: 'Dan',
      me: MY_PERSON('person-dan', 'Dan')
    })
    await pull(dbA)
    await pull(dbD)
    await pull(dbB)
    for (const db of [dbA, dbB, dbD]) expect(roleIn(db, personOf(dbD))).toBe('contributor')
    expect(
      (dbD.prepare('SELECT my_role FROM sync_shares').get() as { my_role: string }).my_role
    ).toBe('contributor')
  })

  it('changes a role to Contributor and back (Contributor)', async () => {
    await writeRoleChange(dbA, transport(), PROJECT, personOf(dbB), 'contributor')
    await pull(dbB)
    await pull(dbA)
    for (const db of [dbA, dbB]) expect(roleIn(db, personOf(dbB))).toBe('contributor')

    await writeRoleChange(dbA, transport(), PROJECT, personOf(dbB), 'editor')
    await pull(dbB)
    await pull(dbA)
    for (const db of [dbA, dbB]) expect(roleIn(db, personOf(dbB))).toBe('editor')
  })

  it('lists no shared capability while a member has advertised nothing, so SyncService refuses Contributor (Contributor)', async () => {
    // Nobody has written a capabilities note here, so no member advertises 'contributor-role'.
    await pull(dbA)
    expect(sharedCapabilities(dbA, shareId)).not.toContain('contributor-role')
    await writeMyCapabilities(dbA, transport(), shareId, {
      projectKey: projectKeyFor(dbA, PROJECT)!,
      keyGeneration: keyGenerationOf(dbA, PROJECT),
      privateKey: identityKeys(dbA).privateKey
    })
    await refreshCapabilities(dbA, transport(), shareId, projectKeyring(dbA, PROJECT))
    // Ben's PC still says nothing, so the list stays empty.
    expect(sharedCapabilities(dbA, shareId)).not.toContain('contributor-role')
  })
})
