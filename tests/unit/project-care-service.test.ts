import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { PlanningService } from '../../electron/services/planning-service'
import { ProjectCareService } from '../../electron/services/project-care-service'
import {
  checksumPathFor,
  verifyChecksumFile,
  writeChecksumFile
} from '../../electron/services/checksum'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { makeWatchedProject } from '../helpers/projects'

const project = (id: string, name: string): WatchedProject =>
  makeWatchedProject({ id, name, color: '#ec4899' })

/** Project settings › Backup and Check and repair: one project's own backups and records. */
describe('ProjectCareService', () => {
  let root: string
  let dataDir: string
  let databasePath: string
  let planning: PlanningService
  let care: ProjectCareService
  let fullBackups: number
  const wedding = project('wedding', 'Wedding: plans')
  const garden = project('garden', 'Garden')

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-project-care-'))
    dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir)
    databasePath = await createMigratedDatabase(dataDir)
    planning = new PlanningService(databasePath, () => [wedding.id, garden.id])
    fullBackups = 0
    care = new ProjectCareService({
      dataDir,
      databasePath,
      writeProjectFile: (projectId, filePath) =>
        fs.writeFileSync(filePath, `project file of ${projectId}`),
      createFullBackup: async () => {
        fullBackups += 1
        return { id: `full-${fullBackups}` }
      }
    })
  })

  afterEach(() => {
    planning.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  describe('backups', () => {
    it('writes a project file with a checksum beside it, under the data folder', async () => {
      const entry = await care.createBackup(wedding, new Date('2026-10-23T09:30:00Z'))
      expect(entry.id).toBe('Wedding  plans 20261023-093000-000.ostler-project')
      expect(path.dirname(entry.filePath)).toBe(path.join(dataDir, 'project-backups', 'wedding'))
      expect(entry.hasChecksum).toBe(true)
      expect(fs.existsSync(`${entry.filePath}.partial`)).toBe(false)
      expect(await care.verifyBackup(wedding.id, entry.id)).toBe('matches')
      expect(care.listBackups(wedding.id).map((backup) => backup.id)).toEqual([entry.id])
      expect(care.listBackups(garden.id)).toEqual([])
    })

    it('never overwrites a backup made in the same moment', async () => {
      const when = new Date('2026-10-23T09:30:00Z')
      const first = await care.createBackup(garden, when)
      const second = await care.createBackup(garden, when)
      expect(second.id).not.toBe(first.id)
      expect(care.listBackups(garden.id)).toHaveLength(2)
    })

    it('leaves no half-written file when writing the project file fails', async () => {
      const failing = new ProjectCareService({
        dataDir,
        databasePath,
        writeProjectFile: (_projectId, filePath) => {
          fs.writeFileSync(filePath, 'half')
          throw new Error('disk full')
        },
        createFullBackup: async () => ({ id: 'unused' })
      })
      await expect(failing.createBackup(garden)).rejects.toThrow('disk full')
      expect(fs.readdirSync(failing.backupsFolder(garden.id))).toEqual([])
    })

    it('finds a damaged backup by its checksum', async () => {
      const entry = await care.createBackup(garden)
      fs.appendFileSync(entry.filePath, 'damage')
      expect(await care.verifyBackup(garden.id, entry.id)).toBe('differs')
    })

    it('deletes a backup with its checksum file', async () => {
      const entry = await care.createBackup(garden)
      care.deleteBackup(garden.id, entry.id)
      expect(fs.existsSync(entry.filePath)).toBe(false)
      expect(fs.existsSync(checksumPathFor(entry.filePath))).toBe(false)
    })

    it('refuses any backup id that is not a file of this project', async () => {
      await care.createBackup(garden)
      expect(() => care.backupPath(garden.id, '../wedding/x.ostler-project')).toThrow()
      expect(() => care.backupPath(garden.id, 'notes.txt')).toThrow()
      expect(() => care.backupPath('../garden', 'x.ostler-project')).toThrow()
      expect(() => care.backupPath(garden.id, 'missing.ostler-project')).toThrow()
    })
  })

  describe('records', () => {
    const breakRecords = () => {
      const milestone = planning.createMilestone(wedding.id, { name: 'Venue' } as never)
      const task = planning.createWorkItem(
        wedding.id,
        { title: 'Book the venue', milestoneId: milestone.id } as never,
        { kind: 'human' },
        'human'
      )
      const other = planning.createWorkItem(
        garden.id,
        { title: 'Dig' } as never,
        { kind: 'human' },
        'human'
      )
      const db = new Database(databasePath)
      db.pragma('foreign_keys = OFF')
      // A milestone gone from under its task (an optional link) ...
      db.prepare('DELETE FROM planning_milestones WHERE id = ?').run(milestone.id)
      // ... and comments on tasks that are gone (they cannot stand alone), in both projects.
      const comment = db.prepare(
        `INSERT INTO planning_comments (id, project_id, work_item_id, author_kind, body, created_at, updated_at)
         VALUES (?, ?, ?, 'human', 'Hello', 0, 0)`
      )
      comment.run('c1', wedding.id, 'gone-task')
      comment.run('c2', garden.id, 'gone-task')
      db.close()
      return { task, other }
    }

    it('finds only this project’s broken records', () => {
      breakRecords()
      const check = care.checkRecords(wedding.id)
      expect(check.databaseOk).toBe(true)
      expect(check.brokenRecords).toEqual([
        { table: 'planning_comments', rows: 1 },
        { table: 'planning_work_items', rows: 1 }
      ])
      expect(check.totalRows).toBeGreaterThan(0)
    })

    it('reports a healthy project as healthy', () => {
      planning.createWorkItem(garden.id, { title: 'Dig' } as never, { kind: 'human' }, 'human')
      const check = care.checkRecords(garden.id)
      expect(check.databaseOk).toBe(true)
      expect(check.brokenRecords).toEqual([])
    })

    it('backs up first, clears optional links, removes orphans, and leaves other projects alone', async () => {
      const { task } = breakRecords()
      const repair = await care.repairRecords(wedding.id)
      expect(fullBackups).toBe(1)
      expect(repair.backupId).toBe('full-1')
      expect(repair.reindexed).toBe(true)
      expect(repair.clearedLinks).toEqual([{ table: 'planning_work_items', rows: 1 }])
      expect(repair.removedRecords).toEqual([{ table: 'planning_comments', rows: 1 }])
      expect(repair.after.brokenRecords).toEqual([])

      const db = new Database(databasePath, { readonly: true })
      const kept = db
        .prepare('SELECT milestone_id FROM planning_work_items WHERE id = ?')
        .get(task.id) as { milestone_id: string | null }
      expect(kept.milestone_id).toBeNull()
      const comments = db.prepare('SELECT id FROM planning_comments ORDER BY id').all()
      db.close()
      expect(comments).toEqual([{ id: 'c2' }])
      expect(care.checkRecords(garden.id).brokenRecords).toEqual([
        { table: 'planning_comments', rows: 1 }
      ])
    })

    it('changes nothing when the backup before a repair fails', async () => {
      breakRecords()
      const noBackup = new ProjectCareService({
        dataDir,
        databasePath,
        writeProjectFile: () => undefined,
        createFullBackup: async () => {
          throw new Error('no room')
        }
      })
      await expect(noBackup.repairRecords(wedding.id)).rejects.toThrow('no room')
      expect(care.checkRecords(wedding.id).brokenRecords).toHaveLength(2)
    })
  })
})

describe('checksum files', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-checksum-'))
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('writes the sha256sum form and checks a file against it', async () => {
    const file = path.join(root, 'export.csv')
    fs.writeFileSync(file, 'abc')
    const { checksumPath, sha256 } = await writeChecksumFile(file)
    expect(sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(fs.readFileSync(checksumPath, 'utf8')).toBe(`${sha256} *export.csv\n`)
    expect(await verifyChecksumFile(file)).toBe('matches')
    fs.writeFileSync(file, 'abd')
    expect(await verifyChecksumFile(file)).toBe('differs')
  })

  it('says when there is no checksum file', async () => {
    const file = path.join(root, 'alone.txt')
    fs.writeFileSync(file, 'x')
    expect(await verifyChecksumFile(file)).toBe('missing')
  })
})
