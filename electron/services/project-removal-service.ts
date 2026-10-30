import fs from 'node:fs'
import { isOwnTaskBranch } from '@shared/legacy-names'
import path from 'node:path'
import Database from 'better-sqlite3'
import simpleGit from 'simple-git'
import type {
  ProjectRemovalArchive,
  ProjectRemovalFolder,
  ProjectRemovalInventory,
  ProjectRemovalPurge,
  WatchedProject
} from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import type { HarnessService } from './harness-service'
import type { PlanningService } from './planning-service'
import { AI_STORAGE_DIRECTORIES } from './ai-storage-service'
import { PERSONAL_PROJECT_ID } from './sync/synced-tables'

/**
 * Removing a project used to mean forgetting it: the config entry went, the
 * session worktrees were unregistered, and everything else - planning records,
 * event history, transcripts, AI drafts, and the private control repository
 * holding every agent commit - stayed on disk under a directory named after a
 * hash of an id nothing referenced any more. Recoverable in principle, lost in
 * practice.
 *
 * This service makes removal a deliberate sequence instead: say what is held,
 * write it back to the project's own folder where the human can actually find
 * it, and only then delete. Each step is separately callable so the UI can
 * stop between them, and nothing here deletes anything until `purge` is
 * called explicitly.
 */
/**
 * Recursive delete that survives Git's read-only object files.
 *
 * Git marks every loose object read-only, and on Windows deleting a read-only
 * file fails with EPERM no matter what `fs.rmSync`'s `force` flag says - a
 * control repository can hold thousands of them, so the whole purge aborted
 * on the first one. Clearing the attribute and retrying is the only way to
 * remove a Git directory on Windows.
 */
function removeDirectoryForcefully(target: string): void {
  const unlink = (file: string): void => {
    try {
      fs.unlinkSync(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
      fs.chmodSync(file, 0o666)
      fs.unlinkSync(file)
    }
  }
  const walk = (current: string): void => {
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const child = path.join(current, entry.name)
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(child)
      else unlink(child)
    }
    fs.rmdirSync(current)
  }
  if (!fs.existsSync(target)) return
  walk(target)
}

/** Number and total size of the regular files under a directory. */
function countFiles(directory: string): { count: number; bytes: number } {
  let count = 0
  let bytes = 0
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (entry.isFile()) {
        count += 1
        try {
          bytes += fs.statSync(child).size
        } catch {
          // A file gone or locked mid-count still counts; its size is unknown.
        }
      }
    }
  }
  walk(directory)
  return { count, bytes }
}

/**
 * Every table carrying a `project_id`, discovered from the schema rather
 * than hardcoded. A hardcoded list silently stops covering tables added
 * later, which is exactly how orphaned rows outlive the project they
 * describe.
 */
export function projectScopedTables(db: Database.Database): string[] {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]
  return tables
    .map((table) => table.name)
    .filter((name) => {
      const columns = db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]
      return columns.some((column) => column.name === 'project_id')
    })
    .sort()
}

/** Deletes every row of a project, in one transaction; what was deleted, by table. */
export function deleteProjectRows(
  db: Database.Database,
  projectId: string
): { table: string; rows: number }[] {
  // The personal share's rows sit under this sentinel id; no project removal may touch them.
  if (projectId === PERSONAL_PROJECT_ID) throw new Error('The personal share is not a project')
  const deletedRows: { table: string; rows: number }[] = []
  const tables = projectScopedTables(db)
  db.transaction(() => {
    const hasShares = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_shares'")
      .get()
    if (hasShares) {
      const share = db
        .prepare('SELECT share_id FROM sync_shares WHERE project_id = ?')
        .get(projectId) as { share_id: string } | undefined
      if (share) {
        for (const table of [
          'sync_members',
          'sync_applied',
          'sync_pending',
          'sync_records',
          'sync_keys'
        ]) {
          const result = db.prepare(`DELETE FROM "${table}" WHERE share_id = ?`).run(share.share_id)
          if (result.changes > 0) deletedRows.push({ table, rows: result.changes })
        }
      }
    }
    for (const table of tables) {
      const result = db.prepare(`DELETE FROM "${table}" WHERE project_id = ?`).run(projectId)
      if (result.changes > 0) deletedRows.push({ table, rows: result.changes })
    }
  })()
  return deletedRows
}

/** Records a package writes are older than its project's `addedAt` by less than this. */
const ADDED_SINCE_MADE_MARGIN_MS = 60_000

export class ProjectRemovalService {
  constructor(
    private readonly databasePath: string,
    private readonly dataDir: string,
    private readonly planningService: PlanningService,
    private readonly harnessService: HarnessService,
    /**
     * Whether an embedded agent process is alive for this session right now.
     * Session status alone cannot answer that: a session open when Ostler quit
     * stays "active" in state forever, and counting it as running blocks
     * removal over an agent that stopped existing days ago.
     */
    private readonly isSessionRunning: (sessionId: string) => boolean = () => false
  ) {}

  /**
   * Directory an archive is written into, inside the project's own folder, or
   * null for a project with no folder: the human then picks one.
   */
  private archiveRoot(project: WatchedProject): string | null {
    const folder = projectFolder(project)
    return folder === null ? null : path.join(folder, '.ostler-archive')
  }

  /** Every AI storage directory this project can have; one list, shared with AIStorageService. */
  private aiDirectoryPaths(project: WatchedProject): string[] {
    return AI_STORAGE_DIRECTORIES.map((name) => path.join(this.dataDir, 'ai', name, project.id))
  }

  /** The project's Library files: `<dataDir>/library/<projectId>`. */
  private libraryDirectory(project: WatchedProject): string {
    return path.join(this.dataDir, 'library', project.id)
  }

  private openDatabase(): Database.Database {
    const db = new Database(this.databasePath)
    db.pragma('foreign_keys = ON')
    return db
  }

  private projectScopedTables(db: Database.Database): string[] {
    return projectScopedTables(db)
  }

  /**
   * Tasks and comments made in these projects more than a minute after each
   * was added: what the person wrote, not what came in the package.
   */
  addedSinceMade(projects: readonly WatchedProject[]): {
    addedTasks: number
    addedComments: number
  } {
    const db = this.openDatabase()
    try {
      const count = (table: string) =>
        projects.reduce(
          (total, project) =>
            total +
            (
              db
                .prepare(
                  `SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ? AND created_at > ?`
                )
                .get(project.id, project.addedAt + ADDED_SINCE_MADE_MARGIN_MS) as { count: number }
            ).count,
          0
        )
      return { addedTasks: count('planning_work_items'), addedComments: count('planning_comments') }
    } finally {
      db.close()
    }
  }

  /**
   * Whether the person has worked in any of these projects since each was
   * added: a task made or changed, or a comment written, more than a minute
   * later. Untouched demos can be made again in another language.
   */
  editedSinceMade(projects: readonly WatchedProject[]): boolean {
    const db = this.openDatabase()
    try {
      const after = (sql: string, project: WatchedProject) =>
        db.prepare(sql).get(project.id, project.addedAt + ADDED_SINCE_MADE_MARGIN_MS) !== undefined
      return projects.some(
        (project) =>
          after(
            'SELECT 1 FROM planning_work_items WHERE project_id = ? AND MAX(created_at, updated_at) > ? LIMIT 1',
            project
          ) ||
          after(
            'SELECT 1 FROM planning_comments WHERE project_id = ? AND created_at > ? LIMIT 1',
            project
          )
      )
    } finally {
      db.close()
    }
  }

  /** Read-only: what Ostler is holding for this project, and what removal would touch. */
  async buildInventory(project: WatchedProject): Promise<ProjectRemovalInventory> {
    const db = this.openDatabase()
    let rowCounts: { table: string; rows: number }[]
    try {
      rowCounts = this.projectScopedTables(db)
        .map((table) => ({
          table,
          rows: (
            db
              .prepare(`SELECT COUNT(*) AS count FROM "${table}" WHERE project_id = ?`)
              .get(project.id) as { count: number }
          ).count
        }))
        .filter((entry) => entry.rows > 0)
    } finally {
      db.close()
    }

    const harnessDir = this.harnessService.getProjectDataDir(project.id)
    const aiDirectories = this.aiDirectoryPaths(project).filter((directory) =>
      fs.existsSync(directory)
    )
    const libraryDir = this.libraryDirectory(project)
    const libraryFiles = fs.existsSync(libraryDir) ? countFiles(libraryDir) : null

    const harnessState = this.harnessService.getState(project)
    const openSessions = harnessState.activeSessions.map((session) => ({
      id: session.id,
      title: session.title,
      lastSeenAt: session.lastSeenAt ?? null,
      running: this.isSessionRunning(session.id)
    }))
    let sessionBranches: string[] = []
    const folder = projectFolder(project)
    try {
      if (folder && fs.existsSync(path.join(folder, '.git'))) {
        const branches = await simpleGit(folder).branch()
        sessionBranches = branches.all.filter((branch) => isOwnTaskBranch(branch))
      }
    } catch {
      // A folder Git cannot read has no agent versions to list; that is an
      // empty inventory, not an error worth blocking removal over.
    }

    return {
      databasePath: this.databasePath,
      toDelete: this.foldersToDelete(project),
      archives: this.archivesWritten(project),
      projectId: project.id,
      projectName: project.name,
      projectPath: projectFolder(project),
      rowCounts,
      totalRows: rowCounts.reduce((sum, entry) => sum + entry.rows, 0),
      harnessDir: fs.existsSync(harnessDir) ? harnessDir : null,
      aiDirectories,
      libraryDir: libraryFiles ? libraryDir : null,
      libraryItemCount: rowCounts.find((entry) => entry.table === 'library_items')?.rows ?? 0,
      libraryFileCount: libraryFiles?.count ?? 0,
      libraryBytes: libraryFiles?.bytes ?? 0,
      sessionBranches,
      openSessions,
      runningSessions: openSessions.filter((session) => session.running).length,
      staleSessions: openSessions.filter((session) => !session.running).length,
      reviewSessions: harnessState.reviewSessions.length,
      archiveRoot: this.archiveRoot(project)
    }
  }

  /** Every folder `purge` deletes, in one list, so the inventory names exactly what goes. */
  private removalFolders(
    project: WatchedProject
  ): Omit<ProjectRemovalFolder, 'fileCount' | 'bytes'>[] {
    return [
      { kind: 'agentData', path: this.harnessService.getProjectDataDir(project.id) },
      { kind: 'taskCopies', path: this.harnessService.getProjectWorkspaceRoot(project.id) },
      ...this.aiDirectoryPaths(project).map((directory) => ({
        kind: 'aiDrafts' as const,
        path: directory
      })),
      { kind: 'library', path: this.libraryDirectory(project) }
    ]
  }

  /** The removal folders that exist now, with their files counted. */
  private foldersToDelete(project: WatchedProject): ProjectRemovalFolder[] {
    return this.removalFolders(project)
      .filter((folder) => fs.existsSync(folder.path))
      .map((folder) => {
        let counted = { count: 0, bytes: 0 }
        try {
          counted = countFiles(folder.path)
        } catch {
          // An unreadable folder is still listed; only its size is unknown.
        }
        return {
          ...folder,
          path: path.resolve(folder.path),
          fileCount: counted.count,
          bytes: counted.bytes
        }
      })
  }

  /** Record archives written earlier into the project's folder, newest first. */
  private archivesWritten(project: WatchedProject): { path: string; writtenAt: number }[] {
    const root = this.archiveRoot(project)
    if (root === null || !fs.existsSync(root)) return []
    try {
      return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const archivePath = path.join(root, entry.name)
          return { path: archivePath, writtenAt: fs.statSync(archivePath).mtimeMs }
        })
        .sort((a, b) => b.writtenAt - a.writtenAt)
    } catch {
      return []
    }
  }

  /**
   * Writes the project's Ostler-held records into its own folder as JSON, plus
   * a README saying what each file is. Inside the project rather than beside
   * it: the whole point is that the data ends up somewhere the person will
   * still be able to find once Ostler has forgotten the project exists. A
   * project with no folder writes to `chosenRoot`, which main asks for.
   */
  async writeArchive(
    project: WatchedProject,
    chosenRoot: string | null = null
  ): Promise<ProjectRemovalArchive> {
    const root = chosenRoot ?? this.archiveRoot(project)
    if (root === null) {
      throw new Error('Choose a folder for the archive: this project has no folder of its own.')
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const archivePath = path.join(root, stamp)
    fs.mkdirSync(archivePath, { recursive: true })

    const db = this.openDatabase()
    const files: { name: string; rows: number; bytes: number }[] = []
    try {
      for (const table of this.projectScopedTables(db)) {
        const rows = db
          .prepare(`SELECT * FROM "${table}" WHERE project_id = ?`)
          .all(project.id) as unknown[]
        if (rows.length === 0) continue
        const name = `${table}.json`
        const contents = JSON.stringify(rows, null, 2)
        fs.writeFileSync(path.join(archivePath, name), contents, 'utf8')
        files.push({ name, rows: rows.length, bytes: Buffer.byteLength(contents, 'utf8') })
      }
    } finally {
      db.close()
    }

    // Library files are not rows: copy them beside the table dumps, so the
    // imported references and documents survive the removal too.
    const libraryDir = this.libraryDirectory(project)
    let libraryFileCount = 0
    if (fs.existsSync(libraryDir) && !fs.lstatSync(libraryDir).isSymbolicLink()) {
      fs.cpSync(libraryDir, path.join(archivePath, 'library'), {
        recursive: true,
        filter: (source) => !fs.lstatSync(source).isSymbolicLink()
      })
      libraryFileCount = countFiles(path.join(archivePath, 'library')).count
    }

    const readme = [
      `# Ostler archive - ${project.name}`,
      '',
      `Written ${new Date().toISOString()} from Ostler's database, before the project`,
      'was removed from Ostler.',
      '',
      "Each JSON file is one database table, containing only this project's rows,",
      'exactly as Ostler stored them. Nothing here is needed by your code; it is',
      'the planning and history Ostler accumulated, kept so that removing the',
      'project does not throw it away.',
      '',
      '## Files',
      '',
      ...files.map((file) => `- \`${file.name}\` - ${file.rows} row(s)`),
      ...(libraryFileCount > 0
        ? [
            `- \`library/\` - ${libraryFileCount} Library file(s): one folder per item, holding`,
            '  the imported original plus any thumbnail, vision copy and extracted text.',
            '  `library_items.json` says which item each folder is.'
          ]
        : []),
      '',
      '## Agent commits',
      '',
      'Agent work is Git history, not rows, so it is not in these files. It lives',
      'on branches in this repository if you used "Copy into my checkout" before',
      'removing the project. Check with:',
      '',
      '```',
      'git branch --list "ostler/*" "nexus/*"',
      '```'
    ].join('\n')
    fs.writeFileSync(path.join(archivePath, 'README.md'), readme, 'utf8')
    files.push({
      name: 'README.md',
      rows: 0,
      bytes: Buffer.byteLength(readme, 'utf8')
    })

    return { archivePath, files, libraryFileCount }
  }

  /**
   * Deletes everything Ostler holds for the project: database rows, AI storage,
   * the harness directory and the agent copies. Agent work stays on its
   * `ostler/*` versions in the project's own repository.
   *
   * Irreversible, and deliberately the only method here that destroys
   * anything. The caller is responsible for having offered the archive and
   * the agent-work export first; this does not check, because a project whose
   * agent never ran has nothing to export and should not be blocked.
   */
  async purge(project: WatchedProject): Promise<ProjectRemovalPurge> {
    // Removes the agent copies through Git, so the repository is never left
    // with records of copies that no longer exist.
    const retainedBranches = await this.harnessService.releaseProjectCopies(project)

    const db = this.openDatabase()
    let deletedRows: { table: string; rows: number }[] = []
    try {
      deletedRows = deleteProjectRows(db, project.id)
    } finally {
      db.close()
    }

    const removedPaths: string[] = []
    const failedPaths: { path: string; reason: string }[] = []
    for (const { path: directory } of this.removalFolders(project)) {
      if (!fs.existsSync(directory)) continue
      // Never delete outside Ostler's own data directory, whatever a stored
      // path claims: these are the only two roots Ostler ever writes to.
      const resolved = path.resolve(directory)
      if (!resolved.startsWith(path.resolve(this.dataDir) + path.sep)) continue
      try {
        removeDirectoryForcefully(resolved)
        removedPaths.push(resolved)
      } catch (error) {
        // A directory Ostler cannot delete is a leftover folder, not a reason
        // to strand the project half-removed with its rows already gone.
        // Report it so the person can delete it, and finish the removal.
        failedPaths.push({
          path: resolved,
          reason: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const libraryDir = path.resolve(this.libraryDirectory(project))
    return {
      deletedRows,
      removedPaths,
      failedPaths,
      retainedBranches,
      libraryDirRemoved: removedPaths.includes(libraryDir)
    }
  }
}
