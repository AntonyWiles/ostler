import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type {
  ChecksumVerdict,
  ProjectBackupEntry,
  ProjectBrokenRecords,
  ProjectRecordsCheck,
  ProjectRecordsRepair,
  WatchedProject
} from '@shared/ostler-api'
import { safeFileName } from '../app/file-names'
import { checksumPathFor, verifyChecksumFile, writeChecksumFile } from './checksum'
import { backupTimestamp } from './database/backup-timestamp'
import { projectScopedTables } from './project-removal-service'
import { myRoleOf } from './sync/roles'
import { t } from '@shared/i18n'
import { Refusal } from '@shared/refusal'
import type { ShareRole } from '@shared/ostler-api/sharing-types'

/** `<dataDir>/project-backups/<projectId>/`: kept apart from the full backups in `backups/`. */
export const PROJECT_BACKUPS_FOLDER = 'project-backups'

const PROJECT_FILE_EXTENSION = '.ostler-project'
/** SQLite's quick check reports at most this many problems. */
const MAX_DATABASE_PROBLEMS = 20

export interface ProjectCareServiceOptions {
  dataDir: string
  databasePath: string
  /** Writes the project file, as Export project does. */
  writeProjectFile(projectId: string, filePath: string): void
  /** A full backup of the data folder, made before Repair changes anything. */
  createFullBackup(): Promise<{ id: string }>
}

/**
 * Looking after one project's data from Project settings: its own backups
 * (project files kept under the data folder, each with a checksum file), and
 * a check of its records with a repair that backs everything up first.
 *
 * Backup ids are file names the renderer got from `listBackups`; each is
 * checked to be a plain project file name directly in the project's folder,
 * so no path from the renderer reaches the filesystem.
 */
export class ProjectCareService {
  constructor(private readonly options: ProjectCareServiceOptions) {}

  backupsFolder(projectId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error('Invalid project id')
    return path.join(this.options.dataDir, PROJECT_BACKUPS_FOLDER, projectId)
  }

  /** Newest first. */
  listBackups(projectId: string): ProjectBackupEntry[] {
    const folder = this.backupsFolder(projectId)
    if (!fs.existsSync(folder)) return []
    return fs
      .readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(PROJECT_FILE_EXTENSION))
      .map((entry) => {
        const filePath = path.join(folder, entry.name)
        const stat = fs.statSync(filePath)
        return {
          id: entry.name,
          filePath,
          createdAt: stat.mtimeMs,
          sizeBytes: stat.size,
          hasChecksum: fs.existsSync(checksumPathFor(filePath))
        }
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * Writes a project file for the project and a checksum file beside it. The
   * file is written under a temporary name first, so a backup that fails
   * part-way never looks like a finished one.
   */
  async createBackup(project: WatchedProject, now = new Date()): Promise<ProjectBackupEntry> {
    const folder = this.backupsFolder(project.id)
    fs.mkdirSync(folder, { recursive: true })
    const base = `${safeFileName(project.name)} ${backupTimestamp(now)}`
    let name = `${base}${PROJECT_FILE_EXTENSION}`
    for (let n = 2; fs.existsSync(path.join(folder, name)); n += 1)
      name = `${base} (${n})${PROJECT_FILE_EXTENSION}`
    const filePath = path.join(folder, name)
    const partial = `${filePath}.partial`
    try {
      this.options.writeProjectFile(project.id, partial)
      fs.renameSync(partial, filePath)
    } finally {
      fs.rmSync(partial, { force: true })
    }
    await writeChecksumFile(filePath)
    const entry = this.listBackups(project.id).find((backup) => backup.id === name)
    if (!entry) throw new Error(t('errors:projectCare.backupNotFound'))
    return entry
  }

  /** The backup's file, refusing anything that is not one of this project's backups. */
  backupPath(projectId: string, backupId: string): string {
    const folder = this.backupsFolder(projectId)
    if (
      typeof backupId !== 'string' ||
      backupId !== path.basename(backupId) ||
      !backupId.endsWith(PROJECT_FILE_EXTENSION)
    )
      throw new Error('Invalid backup id')
    const filePath = path.join(folder, backupId)
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile())
      throw new Error(t('errors:projectCare.backupNotFound'))
    return filePath
  }

  /** Deletes a backup and its checksum file. */
  deleteBackup(projectId: string, backupId: string): void {
    const filePath = this.backupPath(projectId, backupId)
    fs.rmSync(filePath, { force: true })
    fs.rmSync(checksumPathFor(filePath), { force: true })
  }

  verifyBackup(projectId: string, backupId: string): Promise<ChecksumVerdict> {
    return verifyChecksumFile(this.backupPath(projectId, backupId))
  }

  /** Writes the checksum file again, for a backup that has none. */
  async writeBackupChecksum(projectId: string, backupId: string): Promise<ProjectBackupEntry> {
    await writeChecksumFile(this.backupPath(projectId, backupId))
    const entry = this.listBackups(projectId).find((backup) => backup.id === backupId)
    if (!entry) throw new Error(t('errors:projectCare.backupNotFound'))
    return entry
  }

  /** This PC's role in the project's share, or null when it is not shared. */
  private roleHere(projectId: string): ShareRole | null {
    const db = this.openDatabase()
    try {
      return myRoleOf(db, projectId)
    } finally {
      db.close()
    }
  }

  private openDatabase(): Database.Database {
    const db = new Database(this.options.databasePath)
    db.pragma('foreign_keys = ON')
    return db
  }

  /** Read-only. */
  checkRecords(projectId: string): ProjectRecordsCheck {
    const db = this.openDatabase()
    try {
      return checkProjectRecords(db, projectId)
    } finally {
      db.close()
    }
  }

  /**
   * Makes a full backup, then rebuilds the indexes and fixes this project's
   * broken records the way their own rule says (an optional link is cleared,
   * a record that belongs to something gone is removed), then checks again.
   * Nothing changes if the backup fails.
   */
  async repairRecords(projectId: string): Promise<ProjectRecordsRepair> {
    // A Viewer's or Contributor's PC cannot change a shared project (D9), so refuse before the backup is made.
    const role = this.roleHere(projectId)
    if (role === 'viewer' || role === 'contributor') throw new Refusal(t('errors:sharing.readOnly'))
    const backup = await this.options.createFullBackup()
    const db = this.openDatabase()
    try {
      const fixed = repairProjectRecords(db, projectId)
      return { backupId: backup.id, ...fixed, after: checkProjectRecords(db, projectId) }
    } finally {
      db.close()
    }
  }
}

interface ForeignKeyProblem {
  table: string
  rowid: number
  fkid: number
}

/** The project's records that point at a record that is not there. */
function projectForeignKeyProblems(db: Database.Database, projectId: string): ForeignKeyProblem[] {
  const problems: ForeignKeyProblem[] = []
  for (const table of projectScopedTables(db)) {
    const found = db.prepare(`PRAGMA foreign_key_check("${table}")`).all() as {
      rowid: number | null
      fkid: number
    }[]
    if (found.length === 0) continue
    const owner = db.prepare(`SELECT project_id FROM "${table}" WHERE rowid = ?`)
    for (const problem of found) {
      if (problem.rowid === null) continue
      const row = owner.get(problem.rowid) as { project_id: string } | undefined
      if (row?.project_id === projectId)
        problems.push({ table, rowid: problem.rowid, fkid: problem.fkid })
    }
  }
  return problems
}

function countByTable(rows: { table: string; rowid: number }[]): ProjectBrokenRecords[] {
  const counts = new Map<string, Set<number>>()
  for (const row of rows) {
    const seen = counts.get(row.table) ?? new Set<number>()
    seen.add(row.rowid)
    counts.set(row.table, seen)
  }
  return [...counts]
    .map(([table, ids]) => ({ table, rows: ids.size }))
    .sort((a, b) => a.table.localeCompare(b.table))
}

export function checkProjectRecords(db: Database.Database, projectId: string): ProjectRecordsCheck {
  const quick = (
    db.pragma(`quick_check(${MAX_DATABASE_PROBLEMS})`) as { quick_check: string }[]
  ).map((row) => row.quick_check)
  const databaseOk = quick.length === 1 && quick[0] === 'ok'
  let totalRows = 0
  let tableCount = 0
  for (const table of projectScopedTables(db)) {
    const { count } = db
      .prepare(`SELECT COUNT(*) AS count FROM "${table}" WHERE project_id = ?`)
      .get(projectId) as { count: number }
    if (count > 0) {
      totalRows += count
      tableCount += 1
    }
  }
  return {
    checkedAt: Date.now(),
    databaseOk,
    databaseProblems: databaseOk ? [] : quick,
    totalRows,
    tableCount,
    brokenRecords: countByTable(projectForeignKeyProblems(db, projectId))
  }
}

/**
 * Rebuilds the indexes, then fixes each broken record by the rule its link
 * was declared with: ON DELETE SET NULL clears the link, anything else removes
 * the record (it cannot stand without what it belonged to). One transaction.
 */
export function repairProjectRecords(
  db: Database.Database,
  projectId: string
): Pick<ProjectRecordsRepair, 'clearedLinks' | 'removedRecords' | 'reindexed'> {
  let reindexed = false
  try {
    db.exec('REINDEX')
    reindexed = true
  } catch {
    // A file too damaged to reindex still gets its records fixed; the fresh
    // check afterwards says what is left.
  }
  const cleared: { table: string; rowid: number }[] = []
  const removed: { table: string; rowid: number }[] = []
  db.transaction(() => {
    const problems = projectForeignKeyProblems(db, projectId)
    const keys = new Map<string, { id: number; from: string; on_delete: string }[]>()
    const removedRows = new Set<string>()
    for (const problem of problems) {
      const tableKeys =
        keys.get(problem.table) ??
        (db.prepare(`PRAGMA foreign_key_list("${problem.table}")`).all() as {
          id: number
          from: string
          on_delete: string
        }[])
      keys.set(problem.table, tableKeys)
      const rowKey = `${problem.table}:${problem.rowid}`
      if (removedRows.has(rowKey)) continue
      const columns = tableKeys.filter((key) => key.id === problem.fkid)
      if (
        columns.length > 0 &&
        columns.every((key) => key.on_delete.toUpperCase() === 'SET NULL')
      ) {
        try {
          db.prepare(
            `UPDATE "${problem.table}" SET ${columns.map((key) => `"${key.from}" = NULL`).join(', ')} WHERE rowid = ?`
          ).run(problem.rowid)
          cleared.push(problem)
          continue
        } catch {
          // A column that may not be empty: the record goes instead.
        }
      }
      db.prepare(`DELETE FROM "${problem.table}" WHERE rowid = ?`).run(problem.rowid)
      removedRows.add(rowKey)
      removed.push(problem)
    }
  })()
  return { clearedLinks: countByTable(cleared), removedRecords: countByTable(removed), reindexed }
}
