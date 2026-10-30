import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { retryWaiting } from '../../electron/services/sync/apply'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import { answerPersonLink, unlinkedLookalikes } from '../../electron/services/sync/person-links'
import { pullRecords, pushRecords } from '../../electron/services/sync/records'
import {
  joinShare,
  refreshMembers,
  shareProject,
  type MePerson
} from '../../electron/services/sync/sharing'
import { attachSyncCapture } from '../../electron/services/sync/capture'
import { identityKeys, projectKeyFor, projectKeyring } from '../../electron/services/sync/sync-keys'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const PROJECT = 'house-project'
const SETTINGS = { name: 'House', color: '#336699', notes: '', tags: [] as string[] }
const BOB_ON_B: MePerson = {
  personId: 'person-bob-b',
  name: 'Bob',
  initials: 'BO',
  color: '#222222'
}

describe('"Is this Bob?": linking a member to a person added before they joined', () => {
  const tempDir = useTempDir('ostler-person-links-')
  let folder: string
  let dbA: Database.Database
  let dbB: Database.Database

  const transport = (): FolderTransport => new FolderTransport(folder)

  const openPc = async (name: string) => {
    const db = new Database(
      await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), name)))
    )
    attachChangeRecorder(db)
    attachSyncCapture(db)
    return db
  }

  const keysOf = (db: Database.Database) => ({
    projectKey: projectKeyFor(db, PROJECT)!,
    privateKey: identityKeys(db).privateKey
  })

  const shareIdOf = (db: Database.Database): string =>
    (db.prepare('SELECT share_id FROM sync_shares').get() as { share_id: string }).share_id

  const addPerson = (db: Database.Database, id: string, name: string, isMe = 0) =>
    db
      .prepare(
        `INSERT INTO people (id, name, initials, color, is_me, created_at, updated_at)
         VALUES (?, ?, ?, '#123456', ?, 1, 1)`
      )
      .run(id, name, name.trim().slice(0, 2).toUpperCase(), isMe)

  const addTask = (db: Database.Database, id: string, assigneeId: string) =>
    db
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at, assignee_id)
         VALUES (?, ?, 'Paint hall', 'ready', 'medium', 'human', 1, 1, ?)`
      )
      .run(id, PROJECT, assigneeId)

  /** Reads B's member row on A (after A has read the member files) to name its person key. */
  const personKeyOfB = (db: Database.Database): string =>
    (
      db
        .prepare(
          "SELECT COALESCE(person_public_key, public_key) AS k FROM sync_members WHERE name = 'Ben'"
        )
        .get() as { k: string }
    ).k

  /** A reads every member file, as its sync does before each pull. */
  const readMembers = async (db: Database.Database) =>
    refreshMembers(db, transport(), shareIdOf(db), projectKeyring(db, PROJECT))

  beforeEach(async () => {
    folder = path.join(tempDir(), 'shared')
    fs.mkdirSync(folder)
    dbA = await openPc('pc-a-')
    dbB = await openPc('pc-b-')
    addPerson(dbB, 'person-bob-b', 'Bob', 1)
    const invite = await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    await joinShare(dbB, transport(), invite, {
      folder,
      memberName: 'Ben',
      me: BOB_ON_B
    })
    await readMembers(dbA)
  })

  afterEach(() => {
    dbA.close()
    dbB.close()
  })

  it('shows one candidate: the Bob added on this PC, for the member whose Me card is Bob (a)', () => {
    addPerson(dbA, 'person-bob-a', 'Bob')
    addTask(dbA, 'item-1', 'person-bob-a')

    expect(unlinkedLookalikes(dbA, PROJECT)).toEqual([
      {
        personKey: personKeyOfB(dbA),
        memberName: 'Bob',
        candidatePersonId: 'person-bob-a',
        candidateName: 'Bob'
      }
    ])
    // The member's own person arrived with its Me card, and is not a candidate.
    expect(dbA.prepare("SELECT name, is_me FROM people WHERE id = 'person-bob-b'").get()).toEqual({
      name: 'Bob',
      is_me: 0
    })
  })

  it("Yes rewrites the assignments to the member's person, archives the old one, and the other PC follows (b)", async () => {
    addPerson(dbA, 'person-bob-a', 'Bob')
    addTask(dbA, 'item-1', 'person-bob-a')
    // The task and its person reach B before the answer, as they do in a normal sync.
    await pushChanges(dbA, transport(), PROJECT, keysOf(dbA))
    await pushRecords(dbA, transport(), PROJECT, keysOf(dbA), SETTINGS)
    await pullChanges(dbB, transport(), PROJECT, keysOf(dbB))
    await pullRecords(dbB, transport(), PROJECT, keysOf(dbB))
    retryWaiting(dbB, shareIdOf(dbB))
    const [candidate] = unlinkedLookalikes(dbA, PROJECT)

    answerPersonLink(dbA, PROJECT, candidate.personKey, candidate.candidatePersonId, 'yes')

    expect(
      dbA.prepare("SELECT assignee_id FROM planning_work_items WHERE id = 'item-1'").get()
    ).toEqual({
      assignee_id: 'person-bob-b'
    })
    expect(
      dbA
        .prepare("SELECT archived_at IS NOT NULL AS archived FROM people WHERE id = 'person-bob-a'")
        .get()
    ).toEqual({
      archived: 1
    })
    expect(unlinkedLookalikes(dbA, PROJECT)).toEqual([])

    await pushChanges(dbA, transport(), PROJECT, keysOf(dbA))
    await pushRecords(dbA, transport(), PROJECT, keysOf(dbA), SETTINGS)
    await pullChanges(dbB, transport(), PROJECT, keysOf(dbB))
    await pullRecords(dbB, transport(), PROJECT, keysOf(dbB))
    retryWaiting(dbB, shareIdOf(dbB))

    expect(
      dbB.prepare("SELECT assignee_id FROM planning_work_items WHERE id = 'item-1'").get()
    ).toEqual({
      assignee_id: 'person-bob-b'
    })
    // The merged-away person is archived on the other PC too, so it shows one Bob.
    expect(
      dbB
        .prepare("SELECT archived_at IS NOT NULL AS archived FROM people WHERE id = 'person-bob-a'")
        .get()
    ).toEqual({ archived: 1 })
  })

  it('No hides the candidate on this PC, and it does not come back after another pull (c)', async () => {
    addPerson(dbA, 'person-bob-a', 'Bob')
    addTask(dbA, 'item-1', 'person-bob-a')
    const [candidate] = unlinkedLookalikes(dbA, PROJECT)

    answerPersonLink(dbA, PROJECT, candidate.personKey, candidate.candidatePersonId, 'no')
    expect(unlinkedLookalikes(dbA, PROJECT)).toEqual([])

    await pushChanges(dbA, transport(), PROJECT, keysOf(dbA))
    await pushRecords(dbA, transport(), PROJECT, keysOf(dbA), SETTINGS)
    await pullChanges(dbA, transport(), PROJECT, keysOf(dbA))
    await pullRecords(dbA, transport(), PROJECT, keysOf(dbA))
    await readMembers(dbA)

    expect(unlinkedLookalikes(dbA, PROJECT)).toEqual([])
    expect(
      dbA.prepare("SELECT assignee_id FROM planning_work_items WHERE id = 'item-1'").get()
    ).toEqual({
      assignee_id: 'person-bob-a'
    })
  })

  it('matches names ignoring case, outer spaces and repeated spaces, but not other names (d)', () => {
    addPerson(dbA, 'person-spaced', ' bob ')
    addPerson(dbA, 'person-bobby', 'Bobby')
    addTask(dbA, 'item-1', 'person-spaced')
    addTask(dbA, 'item-2', 'person-bobby')

    expect(unlinkedLookalikes(dbA, PROJECT).map((link) => link.candidatePersonId)).toEqual([
      'person-spaced'
    ])
  })

  it('never offers Me as a candidate (e)', () => {
    addPerson(dbA, 'person-me-a', 'Bob', 1)
    addTask(dbA, 'item-1', 'person-me-a')

    expect(unlinkedLookalikes(dbA, PROJECT)).toEqual([])
  })

  it('refuses an answer for a pair that is not a current candidate', () => {
    expect(() => answerPersonLink(dbA, PROJECT, personKeyOfB(dbA), 'person-nobody', 'yes')).toThrow(
      /not-a-candidate/
    )
  })
})
