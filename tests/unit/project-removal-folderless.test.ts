import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { PlanningService } from '../../electron/services/planning-service'
import { ProjectRemovalService } from '../../electron/services/project-removal-service'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

/** Removal of a project that lives only in Ostler (D4): no folder to read or write. */
describe('ProjectRemovalService for a project without a folder', () => {
  const root = useTempDir('ostler-removal-folderless-')
  let dataDir: string
  let database: EventDatabase
  let planning: PlanningService
  let removal: ProjectRemovalService
  let harness: HarnessService
  const project: WatchedProject = makeWatchedProject({
    id: 'folderless',
    name: 'Wedding',
    color: '#ec4899'
  })

  beforeEach(async () => {
    dataDir = path.join(root(), 'data')
    fs.mkdirSync(dataDir)
    const databasePath = await createMigratedDatabase(dataDir)
    database = new EventDatabase(databasePath)
    planning = new PlanningService(databasePath, () => [project.id])
    harness = new HarnessService(dataDir, database)
    removal = new ProjectRemovalService(databasePath, dataDir, planning, harness)
    planning.createWorkItem(
      project.id,
      { title: 'Book the venue' } as never,
      { kind: 'human' },
      'human'
    )
    fs.mkdirSync(path.join(dataDir, 'library', project.id), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'library', project.id, 'guests.md'), '# Guests\n')
  })

  afterEach(() => {
    planning.close()
    database.close()
  })

  it('takes inventory with no folder and no archive location of its own', async () => {
    const inventory = await removal.buildInventory(project)
    expect(inventory.projectPath).toBeNull()
    expect(inventory.archiveRoot).toBeNull()
    expect(inventory.rowCounts).toContainEqual({ table: 'planning_work_items', rows: 1 })
    expect(inventory.libraryFileCount).toBe(1)
    expect(inventory.sessionBranches).toEqual([])
    expect(inventory.archives).toEqual([])
  })

  it('names exactly the folders removal then deletes, with what is in them', async () => {
    fs.mkdirSync(path.join(dataDir, 'ai', 'planning-drafts', project.id), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'ai', 'planning-drafts', project.id, 'draft.md'), 'draft')
    const inventory = await removal.buildInventory(project)
    expect(inventory.toDelete).toContainEqual({
      kind: 'library',
      path: path.resolve(dataDir, 'library', project.id),
      fileCount: 1,
      bytes: Buffer.byteLength('# Guests\n')
    })
    expect(inventory.toDelete.map((folder) => folder.kind)).toContain('aiDrafts')
    const purge = await removal.purge(project)
    expect([...purge.removedPaths].sort()).toEqual(
      inventory.toDelete.map((folder) => folder.path).sort()
    )
  })

  it('counts only the tasks and comments made after the project was', () => {
    // The task from beforeEach came in with the project; this one came later.
    const later = { ...project, addedAt: Date.now() - 2 * 60_000 }
    expect(removal.addedSinceMade([later])).toEqual({ addedTasks: 1, addedComments: 0 })
    const now = { ...project, addedAt: Date.now() }
    expect(removal.addedSinceMade([now])).toEqual({ addedTasks: 0, addedComments: 0 })
  })

  it('knows a project is edited once a task is made or changed after it was', () => {
    const now = { ...project, addedAt: Date.now() }
    expect(removal.editedSinceMade([now])).toBe(false)
    // The project was made two minutes before its task.
    const later = { ...project, addedAt: Date.now() - 2 * 60_000 }
    expect(removal.editedSinceMade([later])).toBe(true)
  })

  it('archives to the folder the human chose, and refuses without one', async () => {
    await expect(removal.writeArchive(project)).rejects.toThrow(/Choose a folder/)

    const chosen = path.join(root(), 'Documents', 'Ostler archives', 'Wedding')
    const archive = await removal.writeArchive(project, chosen)
    expect(path.dirname(archive.archivePath)).toBe(chosen)
    expect(archive.files.map((file) => file.name)).toContain('planning_work_items.json')
    expect(archive.libraryFileCount).toBe(1)
    expect(fs.readFileSync(path.join(archive.archivePath, 'library', 'guests.md'), 'utf8')).toBe(
      '# Guests\n'
    )
  })

  it('purges every record and Ostler folder the project had', async () => {
    // Pictures from agents' reports (N9.1) live in the project's harness folder.
    const pictures = path.join(harness.getProjectDataDir(project.id), 'report-pictures', 's1')
    fs.mkdirSync(pictures, { recursive: true })
    fs.writeFileSync(path.join(pictures, '1-a.png'), 'png')
    const purge = await removal.purge(project)
    expect(fs.existsSync(pictures)).toBe(false)
    expect(purge.deletedRows).toContainEqual({ table: 'planning_work_items', rows: 1 })
    expect(purge.libraryDirRemoved).toBe(true)
    expect(purge.failedPaths).toEqual([])
    expect(planning.listWorkItems(project.id)).toEqual([])
  })
})
