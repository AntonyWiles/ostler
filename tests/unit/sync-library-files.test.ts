import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import {
  pullLibraryFiles,
  pushLibraryFiles,
  type LibraryFileStore
} from '../../electron/services/sync/library-files'
import { joinShare, shareProject } from '../../electron/services/sync/sharing'
import { identityKeys, projectKeyFor } from '../../electron/services/sync/sync-keys'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const PROJECT = 'house-project'
const SETTINGS = { name: 'House', color: '#336699', notes: '', tags: [] }

/** A Library that keeps originals in memory. */
class MemoryStore implements LibraryFileStore {
  readonly files = new Map<string, Buffer>()
  syncedOriginal(_projectId: string, itemId: string): Buffer | null {
    return this.files.get(itemId) ?? null
  }
  async receiveSyncedOriginal(_projectId: string, itemId: string, bytes: Buffer): Promise<void> {
    this.files.set(itemId, bytes)
  }
}

describe('library files in a shared folder', () => {
  const tempDir = useTempDir('ostler-sync-library-')
  let folder: string
  let dbA: Database.Database
  let dbB: Database.Database

  const transport = (): FolderTransport => new FolderTransport(folder)

  const openPc = async (name: string) => {
    const db = new Database(
      await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), name)))
    )
    attachChangeRecorder(db)
    return db
  }

  const keysOf = (db: Database.Database) => ({
    projectKey: projectKeyFor(db, PROJECT)!,
    privateKey: identityKeys(db).privateKey
  })

  const insertFileItem = (db: Database.Database, id: string, bytes: Buffer) => {
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    db.prepare(
      `INSERT INTO library_items (id, project_id, kind, title, file_json, sha256, ai_access, created_at, updated_at)
       VALUES (?, ?, 'document', 'Plan', ?, ?, 'none', 'now', 'now')`
    ).run(id, PROJECT, JSON.stringify({ fileName: 'plan.txt', sha256 }), sha256)
  }

  beforeEach(async () => {
    folder = path.join(tempDir(), 'shared')
    fs.mkdirSync(folder)
    dbA = await openPc('pc-a-')
    dbB = await openPc('pc-b-')
    const invite = await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    await joinShare(dbB, transport(), invite, { folder, memberName: 'Ben' })
  })

  afterEach(() => {
    dbA.close()
    dbB.close()
  })

  it('moves a file from A to B, encrypted in the folder, once', async () => {
    const storeA = new MemoryStore()
    const storeB = new MemoryStore()
    const bytes = Buffer.from('secret-plan-contents '.repeat(50), 'utf8')
    insertFileItem(dbA, 'lib-1', bytes)
    storeA.files.set('lib-1', bytes)

    await pushChanges(dbA, transport(), PROJECT, keysOf(dbA))
    expect(await pushLibraryFiles(dbA, transport(), PROJECT, keysOf(dbA), storeA)).toEqual({
      files: 1,
      problems: []
    })
    expect(await pushLibraryFiles(dbA, transport(), PROJECT, keysOf(dbA), storeA)).toEqual({
      files: 0,
      problems: []
    })
    const [written] = fs.readdirSync(path.join(folder, 'files'))
    expect(fs.readFileSync(path.join(folder, 'files', written)).includes('secret-plan')).toBe(false)

    await pullChanges(dbB, transport(), PROJECT, keysOf(dbB))
    expect(await pullLibraryFiles(dbB, transport(), PROJECT, keysOf(dbB), storeB)).toEqual({
      files: 1,
      problems: []
    })
    expect(storeB.files.get('lib-1')?.equals(bytes)).toBe(true)
    expect(await pullLibraryFiles(dbB, transport(), PROJECT, keysOf(dbB), storeB)).toEqual({
      files: 0,
      problems: []
    })
  })

  it('reports a local file that no longer matches its item instead of sending it', async () => {
    const storeA = new MemoryStore()
    insertFileItem(dbA, 'lib-1', Buffer.from('original'))
    storeA.files.set('lib-1', Buffer.from('changed on disk'))

    expect(await pushLibraryFiles(dbA, transport(), PROJECT, keysOf(dbA), storeA)).toEqual({
      files: 0,
      problems: [{ itemId: 'lib-1', reason: 'hash-mismatch' }]
    })
  })

  it('waits for a file that has not reached the folder yet', async () => {
    insertFileItem(dbA, 'lib-1', Buffer.from('later'))
    await pushChanges(dbA, transport(), PROJECT, keysOf(dbA))
    await pullChanges(dbB, transport(), PROJECT, keysOf(dbB))
    expect(
      await pullLibraryFiles(dbB, transport(), PROJECT, keysOf(dbB), new MemoryStore())
    ).toEqual({ files: 0, problems: [] })
  })
})
