import fs from 'node:fs'
import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type {
  CsvImportOptions,
  CsvEncoding,
  CsvImportPreview,
  CsvUpdateApplyRequest,
  CsvUpdatePreview,
  CsvUpdateResult,
  GithubImportPreview,
  GithubIssueQuery,
  ImportBatch,
  ImportFileInfo,
  ImportRequest,
  ImportResult,
  ImportSource,
  ImportTarget,
  ImportUndoCheck,
  ImportUndoResult,
  PlanningActor,
  PlanningWorkItem,
  TaskValuesRestore,
  TrelloImportOptions,
  TrelloImportPreview,
  UpdateLibraryItemInput,
  UpdatePlanningWorkItemInput,
  WatchedProject
} from '@shared/ostler-api'
import { LIBRARY_MAX_FILE_BYTES, type PlanningFieldValuesInput } from '@shared/ostler-api'
import { parseFieldValueText } from '@shared/planning/custom-fields'
import { analyzeCsv, decodeCsv } from '@shared/import/csv-import'
import {
  analyzeCsvUpdate,
  type CsvUpdateAnalysis,
  type CsvUpdateContext
} from '@shared/import/csv-update'
import {
  MAX_IMPORT_FILE_BYTES,
  type ImportKnownRecords,
  type ImportPlan
} from '@shared/import/import-plan'
import {
  analyzeTrello,
  isTrelloBoard,
  readTrelloBoard,
  type TrelloBoard
} from '@shared/import/trello-import'
import { analyzeGithubIssues, type GithubImportSource } from '@shared/import/github-import'
import { formatGithubRepository, parseGithubRepository } from '@shared/github/github-reference'
import { Refusal } from '@shared/refusal'
import type { GithubIssue, GithubIssueListQuery } from './github/github-client'
import {
  isProjectPackageFormat,
  validateProjectPackage,
  type ProjectPackage
} from '@shared/project-package'
import type { PlanningService } from './planning-service'
import type { ProjectPackageService } from './project-package-service'
import { ImportBatchRepository } from './database/import-batch-repository'
import { PeopleRepository } from './database/people-repository'
import { PersonMatcher } from './person-matcher'
import { freeProjectName } from '@shared/project-names'
import { extractProjectArchive, looksLikeArchive } from './project-archive'
import { decryptProjectFile, looksProtected } from './protected-project-file'
import { t } from '@shared/i18n'

/** A file main read for an import, kept until it is imported or forgotten. */
interface LoadedFile {
  fileName: string
  kind: ImportSource
  bytes?: Uint8Array
  board?: TrelloBoard
  pkg?: ProjectPackage
  /** Where a package's `library/` files are. */
  folder?: string
  /** A folder was picked: every file it names must be there. */
  strictFiles?: boolean
  /** A project file was unpacked here (under the data folder); removed when the file is let go. */
  temporaryFolder?: string
  /** A password-protected project file (N45), waiting for its password. */
  locked?: { filePath: string; temporary: boolean }
  /** Issues read from GitHub (R4.4). */
  github?: GithubImportSource
}

export interface ImportServiceDependencies {
  planning: PlanningService
  packages: ProjectPackageService
  /** The registered projects. */
  getProjects(): WatchedProject[]
  /** Adds a file to a project's Library (as the Library's own import does); its item id. */
  addLibraryFile?(projectId: string, filePath: string): Promise<string>
  updateLibraryItem?(projectId: string, itemId: string, updates: UpdateLibraryItemInput): void
  /** Shows the given pictures in an imported whiteboard's image objects (D21). */
  setWhiteboardPictures?(
    projectId: string,
    whiteboardId: string,
    pictures: { objectId: string; imageItemId: string }[]
  ): void
  /** For the date format's default (month first in the US). */
  locale(): string
  /** Reads a repository's issues (R4.4); only when the person imports from GitHub. */
  github?: {
    listIssues(query: GithubIssueListQuery): Promise<{ issues: GithubIssue[]; truncated: boolean }>
  }
  now?: () => number
  /**
   * Where project files are unpacked, under the data folder. Each import
   * gets a new folder inside, removed when the import runs or is let go.
   */
  unpackDir?: string
}

/** At most this many files are held between picking and importing. */
const MAX_HELD_FILES = 8

/**
 * Import (P6.1): CSV with column and value mapping, Trello board exports and
 * Ostler project packages, each checked in full (a dry run) before anything
 * is written, then written in one transaction through `PlanningService`'s
 * single write points, so search, activity, reminders and repeats all
 * happen. Each import is an `import_batches` row its tasks point at, so it
 * can be undone in one step: its tasks go to the recycle bin, except those
 * changed since, which are kept unless the person says otherwise.
 *
 * A picked file is untrusted: at most 50 MB, never evaluated, control
 * characters stripped, and its text is data, never instructions.
 */
export class ImportService {
  private readonly files = new Map<string, LoadedFile>()
  private readonly batches: ImportBatchRepository

  constructor(private readonly deps: ImportServiceDependencies) {
    this.batches = new ImportBatchRepository(deps.planning.database)
    // Nothing held survives a restart: whatever a crash left unpacked goes.
    if (deps.unpackDir) fs.rmSync(deps.unpackDir, { recursive: true, force: true })
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  // ─── Reading files ────────────────────────────────────────────────────────

  /**
   * Reads a file the person picked: a project file (`.ostler-project`), CSV,
   * a Trello board or a bare project package.
   */
  readFile(filePath: string): ImportFileInfo {
    const stat = fs.lstatSync(filePath)
    if (!stat.isFile()) throw new Error(t('errors:importService.chooseFile'))
    if (looksProtected(filePath))
      return this.hold({
        fileName: path.basename(filePath),
        kind: 'package',
        locked: { filePath, temporary: false }
      })
    if (/\.(ostler|nexus)-project$/i.test(filePath) || looksLikeArchive(filePath))
      return this.readProjectFile(filePath)
    if (stat.size > MAX_IMPORT_FILE_BYTES)
      throw new Error(t('errors:importService.fileLargerThan50'))
    const fileName = path.basename(filePath)
    const bytes = new Uint8Array(fs.readFileSync(filePath))
    if (/\.json$/i.test(fileName)) {
      const json = parseJson(bytes)
      if (isPackage(json)) {
        return this.hold({
          fileName,
          kind: 'package',
          pkg: requirePackage(json),
          folder: path.dirname(filePath),
          strictFiles: false
        })
      }
      if (isTrelloBoard(json))
        return this.hold({ fileName, kind: 'trello', board: readTrelloBoard(json) })
      throw new Error(t('errors:importService.jsonFileNeitherTrello'))
    }
    if (bytes.byteLength === 0) throw new Error(`${fileName} is empty`)
    return this.hold({ fileName, kind: 'csv', bytes })
  }

  /**
   * A project file (D29): unpacked, as hostile, into a new folder under the
   * data folder, then read as an export folder. The folder goes when the
   * import runs, the file is let go, or anything here fails.
   */
  private readProjectFile(filePath: string): ImportFileInfo {
    if (!this.deps.unpackDir) throw new Error('Project files cannot be read here')
    fs.mkdirSync(this.deps.unpackDir, { recursive: true })
    const folder = extractProjectArchive(filePath, path.join(this.deps.unpackDir, uuidv4()))
    try {
      return this.readFolder(folder, { fileName: path.basename(filePath), temporary: true })
    } catch (error) {
      fs.rmSync(folder, { recursive: true, force: true })
      throw error
    }
  }

  /**
   * Opens a password-protected project file the person picked (N45): it is
   * decrypted to a file under the data folder, its tag checked before
   * anything is unpacked, then unpacked and read like any project file. The
   * decrypted copy goes whatever happens. A wrong password keeps the file
   * held, so the person can try again.
   */
  unlockFile(fileId: string, password: string): ImportFileInfo {
    const file = this.held(fileId, 'package')
    if (!file.locked) throw new Error(t('errors:importService.fileNoLongerOpen'))
    const info = this.readProtectedFile(file.locked.filePath, file.fileName, password)
    this.release(fileId)
    return info
  }

  private readProtectedFile(filePath: string, fileName: string, password: string): ImportFileInfo {
    if (!this.deps.unpackDir) throw new Error('Project files cannot be read here')
    fs.mkdirSync(this.deps.unpackDir, { recursive: true })
    const plain = path.join(this.deps.unpackDir, `${uuidv4()}.zip`)
    try {
      decryptProjectFile(filePath, plain, password)
      const info = this.readProjectFile(plain)
      const held = this.files.get(info.fileId)
      if (held) held.fileName = fileName
      return { ...info, fileName }
    } finally {
      fs.rmSync(plain, { force: true })
    }
  }

  /**
   * A project file sent over the automation API: streamed to a file under
   * the data folder (at most `maxBytes`), unpacked and read like a picked
   * one, then the copy goes.
   */
  async readProjectFileStream(
    chunks: AsyncIterable<Uint8Array>,
    fileName: string,
    maxBytes: number,
    password?: string
  ): Promise<ImportFileInfo> {
    if (!this.deps.unpackDir) throw new Error('Project files cannot be read here')
    fs.mkdirSync(this.deps.unpackDir, { recursive: true })
    const archive = path.join(this.deps.unpackDir, `${uuidv4()}.ostler-project`)
    try {
      const fd = fs.openSync(archive, 'wx')
      try {
        let size = 0
        for await (const chunk of chunks) {
          size += chunk.length
          if (size > maxBytes) throw new Error(t('errors:projectArchive.tooLarge'))
          fs.writeSync(fd, chunk)
        }
      } finally {
        fs.closeSync(fd)
      }
      if (looksProtected(archive)) {
        if (!password) throw new Error(t('errors:protectedFile.needsPassword'))
        return this.readProtectedFile(archive, fileName, password)
      }
      const info = this.readProjectFile(archive)
      const held = this.files.get(info.fileId)
      if (held) held.fileName = fileName
      return { ...info, fileName }
    } finally {
      fs.rmSync(archive, { force: true })
    }
  }

  /** Reads a project export folder (`<project>.ostler-project/`, from an earlier version). */
  readFolder(
    folderPath: string,
    unpacked?: { fileName: string; temporary: boolean }
  ): ImportFileInfo {
    const stat = fs.lstatSync(folderPath)
    if (!stat.isDirectory()) throw new Error(t('errors:importService.chooseProjectExportFolder'))
    const packagePath = path.join(folderPath, 'project.json')
    if (!fs.existsSync(packagePath)) throw new Error(t('errors:importService.folderHasNoProject'))
    const packageStat = fs.lstatSync(packagePath)
    if (!packageStat.isFile() || packageStat.size > MAX_IMPORT_FILE_BYTES)
      throw new Error(t('errors:importService.projectJsonNotFile'))
    const json = parseJson(new Uint8Array(fs.readFileSync(packagePath)))
    if (!isPackage(json)) throw new Error(t('errors:importService.projectJsonNotOstler'))
    const pkg = requirePackage(json)
    this.libraryFiles(pkg, folderPath, true)
    return this.hold({
      fileName: unpacked?.fileName ?? path.basename(folderPath),
      kind: 'package',
      pkg,
      folder: folderPath,
      strictFiles: true,
      temporaryFolder: unpacked?.temporary ? folderPath : undefined
    })
  }

  /** Forgets a held file (the dialog closed). */
  forgetFile(fileId: string): void {
    this.release(fileId)
  }

  /** Lets a held file go, with the folder it was unpacked into. */
  private release(fileId: string): void {
    const file = this.files.get(fileId)
    this.files.delete(fileId)
    if (file?.temporaryFolder) fs.rmSync(file.temporaryFolder, { recursive: true, force: true })
    if (file?.locked?.temporary) fs.rmSync(file.locked.filePath, { force: true })
  }

  private hold(file: LoadedFile): ImportFileInfo {
    const fileId = uuidv4()
    this.files.set(fileId, file)
    while (this.files.size > MAX_HELD_FILES) this.release(this.files.keys().next().value!)
    const info: ImportFileInfo = {
      fileId,
      fileName: file.fileName,
      kind: file.kind,
      sizeBytes: file.bytes?.byteLength ?? 0
    }
    if (file.locked) info.locked = true
    if (file.pkg) {
      info.packageSummary = {
        name: file.pkg.project.name,
        milestoneCount: file.pkg.milestones.length,
        taskCount: file.pkg.tasks.length,
        fileCount: this.libraryFiles(file.pkg, file.folder ?? null, false).found.length,
        isTemplate: file.pkg.template !== null
      }
    }
    return info
  }

  private held(fileId: string, kind: ImportSource): LoadedFile {
    const file = typeof fileId === 'string' ? this.files.get(fileId) : undefined
    if (!file) throw new Error(t('errors:importService.fileNoLongerOpen'))
    if (file.kind !== kind) throw new Error(`That file is not a ${kind} file`)
    return file
  }

  /**
   * The package's documents and images, found beside it. Every file must be
   * a plain file inside `library/` and no bigger than the Library takes;
   * when `strict`, a missing one refuses the whole import.
   */
  private libraryFiles(
    pkg: ProjectPackage,
    folder: string | null,
    strict: boolean
  ): { found: { index: number; filePath: string }[]; missing: string[] } {
    const found: { index: number; filePath: string }[] = []
    const missing: string[] = []
    const root = folder ? path.resolve(folder, 'library') : null
    pkg.library.forEach((item, index) => {
      if (!item.file) return
      const filePath = root ? path.resolve(folder!, item.file) : null
      const usable =
        filePath !== null &&
        root !== null &&
        filePath.startsWith(root + path.sep) &&
        fs.existsSync(filePath) &&
        fs.lstatSync(filePath).isFile()
      if (!usable) {
        if (strict) throw new Error(`library[${index}].file '${item.file}' is not in the folder`)
        missing.push(item.title)
        return
      }
      if (fs.statSync(filePath).size > LIBRARY_MAX_FILE_BYTES)
        throw new Error(t('errors:importService.largerThanLibraryTakes', { file: item.file }))
      found.push({ index, filePath })
    })
    return { found, missing }
  }

  /**
   * Import tasks › From GitHub issues (R4.4, D40): reads the repository's
   * issues, as the person asked, and holds them like a picked file until the
   * import runs or the dialog closes.
   */
  async loadGithubIssues(query: GithubIssueQuery): Promise<ImportFileInfo> {
    const source = await this.readGithubIssues(query)
    return this.hold({
      fileName: formatGithubRepository(source),
      kind: 'github',
      github: source
    })
  }

  private async readGithubIssues(query: GithubIssueQuery): Promise<GithubImportSource> {
    if (!this.deps.github) throw new Error('GitHub is not available here')
    const repository = parseGithubRepository(
      typeof query?.repository === 'string' ? query.repository : ''
    )
    if (!repository) throw new Refusal(t('errors:github.repositoryInvalid'))
    const labels = Array.isArray(query.labels)
      ? query.labels
          .filter((label): label is string => typeof label === 'string')
          .map((label) => label.trim())
          .filter((label) => label.length > 0 && label.length <= 100 && !label.includes(','))
          .slice(0, 20)
      : []
    const milestone =
      typeof query.milestone === 'string' ? query.milestone.trim().slice(0, 200) : ''
    const { issues, truncated } = await this.deps.github.listIssues({
      ...repository,
      state: query.state === 'all' ? 'all' : 'open',
      labels,
      milestone
    })
    return {
      ...repository,
      truncated,
      issues: issues.map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state === 'open' ? 'open' : 'closed',
        body: issue.body,
        labels: issue.labels,
        assignees: issue.assignees,
        milestone: issue.milestone
      }))
    }
  }

  // ─── Dry runs ─────────────────────────────────────────────────────────────

  private known(projectId: string | null): ImportKnownRecords {
    const people = new PeopleRepository(this.deps.planning.database)
      .list(true)
      .map((person) => person.name)
    if (!projectId) return { milestones: [], people }
    this.requireProject(projectId)
    return {
      milestones: this.deps.planning.listMilestones(projectId).map((milestone) => milestone.name),
      people,
      iterations: this.deps.planning.iterations.list(projectId).map((iteration) => iteration.name),
      types: this.deps.planning.taskTypes.list(projectId).map((type) => type.name),
      fields: this.deps.planning.listFields(projectId),
      columns: this.deps.planning.columns.get(projectId)
    }
  }

  previewCsv(
    fileId: string,
    options: CsvImportOptions = {},
    projectId: string | null = null
  ): CsvImportPreview {
    return this.analyzeCsvFile(fileId, options, projectId).preview
  }

  private analyzeCsvFile(fileId: string, options: CsvImportOptions, projectId: string | null) {
    const file = this.held(fileId, 'csv')
    const decoded = decodeCsv(file.bytes!, options?.encoding)
    return analyzeCsv(decoded, options ?? {}, this.known(projectId), this.deps.locale())
  }

  previewTrello(
    fileId: string,
    options: TrelloImportOptions = {},
    projectId: string | null = null
  ): TrelloImportPreview {
    const file = this.held(fileId, 'trello')
    return analyzeTrello(file.board!, options ?? {}, this.known(projectId)).preview
  }

  previewGithub(fileId: string, projectId: string | null = null): GithubImportPreview {
    return this.analyzeGithub(this.held(fileId, 'github').github!, projectId).preview
  }

  /** Issues already linked to a task in the project are left out (D40). */
  private analyzeGithub(source: GithubImportSource, projectId: string | null) {
    const linked = projectId
      ? this.deps.planning.githubLinks.linkedNumbers(projectId, source.owner, source.repo)
      : new Set<number>()
    return analyzeGithubIssues(source, this.known(projectId), linked)
  }

  // ─── Importing ────────────────────────────────────────────────────────────

  /** Runs an import the dialog prepared, into a project or a new one. */
  async runImport(
    fileId: string,
    request: ImportRequest,
    target: ImportTarget,
    actor: PlanningActor = this.deps.planning.humanActor()
  ): Promise<ImportResult> {
    const kind = request?.kind
    if (kind === 'package')
      return this.importPackage(fileId, target?.kind === 'new' ? target.name : undefined)
    const projectId = target?.kind === 'project' ? target.projectId : null
    let plan: ImportPlan
    let name: string
    const file = this.held(fileId, kind)
    if (kind === 'csv') {
      plan = this.analyzeCsvFile(fileId, request.options ?? {}, projectId).plan
      name = file.fileName.replace(/\.[^.]+$/, '')
    } else if (kind === 'trello') {
      plan = analyzeTrello(file.board!, request.options ?? {}, this.known(projectId)).plan
      name = file.board!.name
    } else if (kind === 'github') {
      plan = this.analyzeGithub(file.github!, projectId).plan
      name = file.github!.repo
    } else {
      throw new Error('Unknown import')
    }
    const result =
      target?.kind === 'project'
        ? this.importPlan(target.projectId, plan, kind, file.fileName, actor)
        : await this.importPlanIntoNewProject(
            target?.name?.trim() ||
              freeProjectName(
                name,
                this.deps.getProjects().map((project) => project.name)
              ),
            plan,
            kind,
            file.fileName,
            actor
          )
    this.files.delete(fileId)
    return result
  }

  /**
   * CSV text from the automation API, with the same dry run and the same
   * writer as the app. `dryRun` returns the preview and writes nothing.
   */
  importCsvText(
    projectId: string,
    text: string,
    options: CsvImportOptions,
    fileName: string,
    dryRun: boolean,
    actor: PlanningActor
  ): CsvImportPreview | ImportResult {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Send the CSV text as csv')
    if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_FILE_BYTES)
      throw new Error(t('errors:importService.csvLargerThan50'))
    const analysis = analyzeCsv(
      { text: text.replace(/^\ufeff/, ''), encoding: 'utf-8' },
      options,
      this.known(projectId),
      this.deps.locale()
    )
    if (dryRun) return analysis.preview
    return this.importPlan(projectId, analysis.plan, 'csv', fileName, actor)
  }

  /**
   * Issues from GitHub through the automation API (R4.4), with the app's dry
   * run and writer. `dryRun` returns the preview and writes nothing.
   */
  async importGithubIssues(
    projectId: string,
    query: GithubIssueQuery,
    dryRun: boolean,
    actor: PlanningActor
  ): Promise<GithubImportPreview | ImportResult> {
    this.requireProject(projectId)
    const source = await this.readGithubIssues(query)
    const analysis = this.analyzeGithub(source, projectId)
    if (dryRun) return analysis.preview
    return this.importPlan(
      projectId,
      analysis.plan,
      'github',
      formatGithubRepository(source),
      actor
    )
  }

  /** Into an existing project, in one transaction: all of it or none of it. */
  importPlan(
    projectId: string,
    plan: ImportPlan,
    source: ImportSource,
    fileName: string,
    actor: PlanningActor
  ): ImportResult {
    const project = this.requireProject(projectId)
    if (plan.tasks.length === 0) throw new Error(t('errors:importService.thereNothingImportNo'))
    const batchId = uuidv4()
    this.deps.planning.runInTransaction(() =>
      this.writePlan(projectId, plan, { id: batchId, source, fileName }, actor)
    )
    return this.result(batchId, project.name, plan.skipped, [])
  }

  private async importPlanIntoNewProject(
    name: string,
    plan: ImportPlan,
    source: ImportSource,
    fileName: string,
    actor: PlanningActor
  ): Promise<ImportResult> {
    if (plan.tasks.length === 0) throw new Error(t('errors:importService.thereNothingImportNo'))
    const batchId = uuidv4()
    const created = await this.deps.packages.createProjectWithRecords(
      { name: name.slice(0, 80), color: '', notes: '', tags: [], folder: null },
      'points',
      (projectId) => this.writePlan(projectId, plan, { id: batchId, source, fileName }, actor)
    )
    return this.result(batchId, created.project.name, plan.skipped, [])
  }

  /** A package or an export folder lands as a new project, with its Library files. */
  private async importPackage(fileId: string, name?: string): Promise<ImportResult> {
    const file = this.held(fileId, 'package')
    if (file.locked) throw new Error(t('errors:protectedFile.needsPassword'))
    let imported = false
    try {
      const result = await this.writePackage(file, name)
      imported = true
      return result
    } finally {
      // A project file's unpacked folder goes, whether the import worked or not.
      if (imported || file.temporaryFolder) this.release(fileId)
    }
  }

  private async writePackage(file: LoadedFile, name?: string): Promise<ImportResult> {
    const pkg = file.pkg!
    const files = this.libraryFiles(pkg, file.folder ?? null, file.strictFiles === true)
    const batchId = uuidv4()
    const created = await this.deps.packages.createProjectFromPackage(pkg, {
      name: name?.trim() || undefined,
      importBatch: { id: batchId, source: 'package', fileName: file.fileName }
    })
    const projectId = created.project.id
    const warnings = files.missing.map((title) =>
      t('errors:importService.fileWasNotBeside', { title })
    )
    // The new item of each file added, by its place in the package.
    const added = new Map<number, string>()
    for (const { index, filePath } of files.found) {
      const item = pkg.library[index]
      try {
        if (!this.deps.addLibraryFile)
          throw new Error(t('errors:importService.libraryNotAvailable'))
        const itemId = await this.deps.addLibraryFile(projectId, filePath)
        added.set(index, itemId)
        this.deps.updateLibraryItem?.(projectId, itemId, {
          title: item.title,
          summary: item.summary,
          tags: item.tags,
          ...(item.aiAccess ? { aiAccess: item.aiAccess } : {})
        })
      } catch (error) {
        warnings.push(`${item.title}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    // Whiteboards show the pictures that arrived (D21); the others stay missing on the board.
    const byBoard = new Map<string, { objectId: string; imageItemId: string }[]>()
    for (const picture of created.pendingPictures ?? []) {
      const imageItemId = added.get(picture.libraryIndex)
      if (!imageItemId) continue
      const shown = byBoard.get(picture.whiteboardId) ?? []
      shown.push({ objectId: picture.objectId, imageItemId })
      byBoard.set(picture.whiteboardId, shown)
    }
    for (const [whiteboardId, pictures] of byBoard) {
      try {
        this.deps.setWhiteboardPictures?.(projectId, whiteboardId, pictures)
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error))
      }
    }
    return this.result(batchId, created.project.name, 0, warnings)
  }

  /**
   * Writes the batch and its tasks; returns the people it created. Call inside
   * a transaction. An import sets off no rules (D45).
   */
  private writePlan(
    projectId: string,
    plan: ImportPlan,
    batch: { id: string; source: ImportSource; fileName: string },
    actor: PlanningActor
  ): string[] {
    return this.deps.planning.withoutRules(() =>
      this.writePlanRecords(projectId, plan, batch, actor)
    )
  }

  private writePlanRecords(
    projectId: string,
    plan: ImportPlan,
    batch: { id: string; source: ImportSource; fileName: string },
    actor: PlanningActor
  ): string[] {
    const planning = this.deps.planning
    this.batches.insert({
      id: batch.id,
      projectId,
      source: batch.source,
      fileName: batch.fileName.slice(0, 260),
      createdAt: this.now(),
      itemCount: 0,
      undoneAt: null
    })
    const people = new PersonMatcher(planning.database, true, projectId)
    for (const name of plan.people) people.resolve(name)
    const milestones = new Map(
      planning
        .listMilestones(projectId)
        .map((milestone) => [milestone.name.toLowerCase(), milestone.id])
    )
    const milestoneId = (name: string) => {
      const key = name.toLowerCase()
      if (!milestones.has(key))
        milestones.set(key, planning.createMilestone(projectId, { name }).id)
      return milestones.get(key)!
    }
    // Iterations (R6.1) by name, any case; a name the project has none of is left out.
    const iterations = new Map(
      planning.iterations
        .list(projectId)
        .map((iteration) => [iteration.name.toLowerCase(), iteration.id])
    )
    // Task types (N2.7a) by name, any case, made when the project has none of
    // that name, as labels are. Past the project's limit a task comes in with none.
    const typeIds = new Map<string, string | null>()
    const typeIdFor = (name: string): string | null => {
      const key = name.trim().toLowerCase()
      if (!typeIds.has(key)) {
        try {
          typeIds.set(key, planning.taskTypes.ensureByName(projectId, name).id)
        } catch {
          typeIds.set(key, null)
        }
      }
      return typeIds.get(key) ?? null
    }
    // Custom fields (R2.2): the new ones first, so their options exist for the values.
    const fields = new Map(planning.listFields(projectId).map((field) => [field.id, field]))
    for (const field of plan.newFields ?? []) {
      const existing = [...fields.values()].find(
        (candidate) => candidate.name.toLowerCase() === field.name.toLowerCase()
      )
      fields.set(
        field.ref,
        existing ??
          planning.createField(projectId, {
            name: field.name,
            type: field.type,
            options: field.options.map((name) => ({ name }))
          })
      )
    }
    const fieldValuesOf = (texts: Record<string, string> | undefined) => {
      const values: PlanningFieldValuesInput = {}
      for (const [ref, text] of Object.entries(texts ?? {})) {
        const field = fields.get(ref)
        if (!field) continue
        try {
          const value = parseFieldValueText(field, text)
          if (value !== null) values[field.id] = value
        } catch {
          // The dry run said this value would be left out.
        }
      }
      return values
    }
    // A plan lists a parent and what a task waits on before it (R4.2).
    const created = new Map<number, string>()
    const createdId = (line: number) => {
      const id = created.get(line)
      if (!id) throw new Error(`The import plan names line ${line} before creating it`)
      return id
    }
    for (const task of plan.tasks) {
      const item = planning.createWorkItem(
        projectId,
        {
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          labels: task.labels,
          acceptanceCriteria: task.checklist.map((entry) => entry.text),
          targetDate: task.dueDate,
          startDate: task.startDate,
          showFrom: task.showFrom ?? null,
          someday: task.someday ?? false,
          impact: task.impact ?? null,
          effort: task.effort ?? null,
          assigneeId: task.assigneeName ? people.resolve(task.assigneeName) : null,
          estimate: task.estimate,
          milestoneId: task.milestoneName ? milestoneId(task.milestoneName) : null,
          iterationId: task.iterationName
            ? (iterations.get(task.iterationName.toLowerCase()) ?? null)
            : null,
          typeId: task.typeName ? typeIdFor(task.typeName) : null,
          fieldValues: fieldValuesOf(task.fieldTexts),
          parentWorkItemId: task.parentLine !== undefined ? createdId(task.parentLine) : null,
          dependencyIds: (task.waitsOnLines ?? []).map(createdId)
        },
        actor,
        'imported',
        batch.id
      )
      created.set(task.line, item.id)
      // The task links the issue it came from, with what the import just read (R4.4).
      if (task.githubIssue) {
        planning.githubLinks.add(
          projectId,
          item.id,
          {
            owner: task.githubIssue.owner,
            repo: task.githubIssue.repo,
            number: task.githubIssue.number,
            kind: 'issue',
            fetched: {
              kind: 'issue',
              title: task.githubIssue.title,
              state: task.githubIssue.state,
              fetchedAt: this.now()
            }
          },
          this.now()
        )
      }
      for (const entry of task.checklist) {
        if (entry.checked) planning.setChecklistItemChecked(item.id, entry.text, true, actor)
      }
    }
    // A label's colour comes across only where the project has none for it yet.
    const coloured = new Set(
      planning
        .listProjectLabels(projectId)
        .filter((label) => label.hasColor)
        .map((label) => label.name)
    )
    for (const label of plan.labelColors) {
      if (!coloured.has(label.name)) planning.setLabelColor(projectId, label.name, label.color)
    }
    this.batches.finish(batch.id, plan.tasks.length, this.now())
    return people.created
  }

  private result(
    batchId: string,
    projectName: string,
    skipped: number,
    warnings: string[]
  ): ImportResult {
    const batch = this.batches.get(batchId)!
    return { batch, projectId: batch.projectId, projectName, skipped, warnings }
  }

  // ─── Edit in Excel (N2.8, N23) ────────────────────────────────────────────

  /**
   * Reads the file Edit in Excel wrote (or another the person picked) for
   * Bring changes back. Excel holds a lock on a file it has open; when that
   * stops the read, the person is told to close it.
   */
  readEditFile(filePath: string): ImportFileInfo {
    let bytes: Uint8Array
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) throw new Error(t('errors:importService.chooseFile'))
      if (stat.size > MAX_IMPORT_FILE_BYTES)
        throw new Error(t('errors:importService.fileLargerThan50'))
      bytes = new Uint8Array(fs.readFileSync(filePath))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')
        throw new Refusal(t('errors:importService.closeInExcel'))
      if (code === 'ENOENT') throw new Refusal(t('errors:importService.editFileGone'))
      throw error
    }
    if (bytes.byteLength === 0) throw new Error(`${path.basename(filePath)} is empty`)
    return this.hold({ fileName: path.basename(filePath), kind: 'csv', bytes })
  }

  /** What the matcher knows about a project: its live tasks, people, milestones and fields. */
  private updateContext(projectId: string): CsvUpdateContext {
    const project = this.requireProject(projectId)
    const planning = this.deps.planning
    return {
      tasks: planning.listWorkItems(projectId),
      lookup: (id) => {
        try {
          const item = planning.getWorkItem(id)
          if (item.projectId !== projectId) return 'otherProject'
          return 'archived'
        } catch {
          return null
        }
      },
      people: new PeopleRepository(planning.database).list(true),
      milestones: planning.listMilestones(projectId),
      iterations: planning.iterations.list(projectId),
      taskTypes: planning.taskTypes.list(projectId),
      fields: planning.listFields(projectId),
      columns: planning.columns.get(projectId),
      estimateUnit: project.estimateUnit ?? 'points'
    }
  }

  private analyzeUpdate(
    projectId: string,
    file: { text: string; encoding: CsvEncoding },
    fileName: string
  ) {
    return analyzeCsvUpdate(
      file,
      fileName,
      this.updateContext(projectId),
      this.known(projectId),
      this.deps.locale()
    )
  }

  /** Bring changes back's preview of a held file: nothing is written. */
  previewCsvUpdate(fileId: string, projectId: string): CsvUpdatePreview {
    const file = this.held(fileId, 'csv')
    return this.analyzeUpdate(projectId, decodeCsv(file.bytes!), file.fileName).preview
  }

  /** Applies a held file's changes (the ticked ones), then lets the file go. */
  applyCsvUpdate(
    fileId: string,
    projectId: string,
    request: CsvUpdateApplyRequest,
    actor: PlanningActor
  ): CsvUpdateResult {
    const file = this.held(fileId, 'csv')
    const analysis = this.analyzeUpdate(projectId, decodeCsv(file.bytes!), file.fileName)
    const result = this.writeCsvUpdate(projectId, analysis, request, file.fileName, actor)
    this.files.delete(fileId)
    return result
  }

  /**
   * `POST /import/csv` with `updateById` (N2.8): the same matching as Bring
   * changes back. `dryRun` returns the preview and writes nothing.
   */
  updateCsvText(
    projectId: string,
    text: string,
    fileName: string,
    request: CsvUpdateApplyRequest,
    dryRun: boolean,
    actor: PlanningActor
  ): CsvUpdatePreview | CsvUpdateResult {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Send the CSV text as csv')
    if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_FILE_BYTES)
      throw new Error(t('errors:importService.csvLargerThan50'))
    const analysis = this.analyzeUpdate(
      projectId,
      { text: text.replace(/^\ufeff/, ''), encoding: 'utf-8' },
      fileName
    )
    if (dryRun) return analysis.preview
    return this.writeCsvUpdate(projectId, analysis, request, fileName, actor)
  }

  /**
   * One transaction: every ticked task through `updateWorkItem` (so
   * activity, reminders, search and rules see each change), then the ticked
   * new rows as an import batch. Returns the old values, for one undo.
   */
  private writeCsvUpdate(
    projectId: string,
    analysis: CsvUpdateAnalysis,
    request: CsvUpdateApplyRequest,
    fileName: string,
    actor: PlanningActor
  ): CsvUpdateResult {
    const taskIds = Array.isArray(request?.taskIds) ? new Set(request.taskIds) : null
    const newLines = Array.isArray(request?.newLines) ? new Set(request.newLines) : null
    const updates = analysis.updates.filter((update) => !taskIds || taskIds.has(update.taskId))
    const plan: ImportPlan = {
      ...analysis.plan,
      tasks: analysis.plan.tasks.filter((task) => !newLines || newLines.has(task.line))
    }
    if (updates.length === 0 && plan.tasks.length === 0)
      throw new Refusal(t('errors:importService.nothingToBringBack'))
    const planning = this.deps.planning
    const batchId = plan.tasks.length > 0 ? uuidv4() : null
    const undo = planning.runInTransaction(() => {
      const restores = updates.map((update) => {
        const before = planning.getWorkItem(update.taskId)
        const values = previousValues(before, update.updates)
        try {
          planning.updateWorkItem(update.taskId, update.updates, actor)
        } catch (error) {
          throw new Error(
            `${update.title}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
        return { id: update.taskId, values }
      })
      if (batchId) this.writePlan(projectId, plan, { id: batchId, source: 'csv', fileName }, actor)
      return restores
    })
    return {
      changed: updates.map(({ taskId, title, columns }) => ({ taskId, title, columns })),
      undo,
      batch: batchId ? this.batches.get(batchId)! : null
    }
  }

  /** Bring changes back's undo: every task's old values back, in one transaction. */
  restoreTaskValues(
    projectId: string,
    restores: TaskValuesRestore[],
    actor: PlanningActor
  ): number {
    this.requireProject(projectId)
    if (!Array.isArray(restores)) throw new Error('Send the values to put back')
    const planning = this.deps.planning
    return planning.runInTransaction(() => {
      let count = 0
      for (const restore of restores) {
        const id = typeof restore?.id === 'string' ? restore.id : ''
        const item = planning.getWorkItem(id)
        if (item.projectId !== projectId) throw new Refusal('That task is in another project')
        planning.updateWorkItem(id, restorableValues(restore.values), actor)
        count += 1
      }
      return count
    })
  }

  // ─── History and undo ─────────────────────────────────────────────────────

  /** Every import into a registered project, newest first. */
  listBatches(): ImportBatch[] {
    return this.batches.list(this.deps.getProjects().map((project) => project.id))
  }

  private requireBatch(batchId: string): ImportBatch {
    const batch = typeof batchId === 'string' ? this.batches.get(batchId) : null
    if (!batch) throw new Error('Import not found')
    this.requireProject(batch.projectId)
    return batch
  }

  /** What "Undo import" would do: the tasks still there, and those changed since. */
  checkUndo(batchId: string): ImportUndoCheck {
    const batch = this.requireBatch(batchId)
    const db = this.deps.planning.database
    const tasks = db
      .prepare(
        `SELECT item.id, item.title, item.linked_harness_task_id,
           (item.updated_at > @at
             OR EXISTS (SELECT 1 FROM planning_field_changes change
                        WHERE change.work_item_id = item.id AND change.at > @at
                          AND change.field NOT IN ('deleted', 'restored'))
             OR EXISTS (SELECT 1 FROM planning_status_history history
                        WHERE history.work_item_id = item.id AND history.at > @at)
             OR EXISTS (SELECT 1 FROM planning_comments comment
                        WHERE comment.work_item_id = item.id AND comment.created_at > @at)
           ) AS changed
         FROM planning_work_items item
         WHERE item.import_batch_id = @batch AND item.deleted_at IS NULL
         ORDER BY item.created_at, item.rowid`
      )
      .all({ at: batch.createdAt, batch: batch.id }) as {
      id: string
      title: string
      linked_harness_task_id: string | null
      changed: number
    }[]
    return {
      batch,
      taskCount: tasks.length,
      // Work an agent is linked to cannot go to the bin; it counts as changed.
      changed: tasks
        .filter((task) => task.changed || task.linked_harness_task_id)
        .map(({ id, title }) => ({ id, title }))
    }
  }

  /**
   * "Undo import": the batch's tasks go to the recycle bin, in one
   * transaction. Tasks changed since the import stay unless `includeChanged`.
   */
  undo(batchId: string, includeChanged: boolean, actor: PlanningActor): ImportUndoResult {
    const check = this.checkUndo(batchId)
    if (check.batch.undoneAt !== null)
      throw new Error(t('errors:importService.importWasAlreadyUndone'))
    const db = this.deps.planning.database
    const changed = new Set(check.changed.map((task) => task.id))
    const ids = (
      db
        .prepare(
          `SELECT id, linked_harness_task_id FROM planning_work_items
           WHERE import_batch_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid`
        )
        .all(batchId) as { id: string; linked_harness_task_id: string | null }[]
    ).filter((task) => !task.linked_harness_task_id && (includeChanged || !changed.has(task.id)))
    const movedIds = ids.map((task) => task.id)
    this.deps.planning.runInTransaction(() => {
      for (const id of movedIds) this.deps.planning.moveWorkItemToBin(id, actor)
      this.batches.setUndoneAt(batchId, this.now())
    })
    const moved = new Set(movedIds)
    return {
      batch: this.batches.get(batchId)!,
      movedIds,
      kept: check.changed.filter((task) => !moved.has(task.id))
    }
  }

  /** Undoes "Undo import": the tasks it moved come back from the recycle bin. */
  restore(batchId: string, taskIds: string[], actor: PlanningActor): ImportBatch {
    this.requireBatch(batchId)
    if (!Array.isArray(taskIds)) throw new Error('taskIds must be a list')
    const db = this.deps.planning.database
    const ours = new Set(
      (
        db.prepare('SELECT id FROM planning_work_items WHERE import_batch_id = ?').all(batchId) as {
          id: string
        }[]
      ).map((row) => row.id)
    )
    this.deps.planning.runInTransaction(() => {
      for (const id of taskIds) if (ours.has(id)) this.deps.planning.restoreWorkItem(id, actor)
      this.batches.setUndoneAt(batchId, null)
    })
    return this.batches.get(batchId)!
  }

  private requireProject(projectId: string): WatchedProject {
    const project = this.deps.getProjects().find((entry) => entry.id === projectId)
    if (!project) throw new Error('Project not found')
    return project
  }
}

/** The fields an Edit in Excel update may change, and so the ones its undo puts back. */
const RESTORABLE_KEYS = [
  'title',
  'description',
  'status',
  'priority',
  'assigneeId',
  'startDate',
  'targetDate',
  'showFrom',
  'someday',
  'impact',
  'effort',
  'estimate',
  'milestoneId',
  'iterationId',
  'typeId',
  'labels',
  'acceptanceCriteria',
  'fieldValues'
] as const satisfies readonly (keyof UpdatePlanningWorkItemInput)[]

/** A task's values, before an update, for the fields the update changes. */
function previousValues(
  task: PlanningWorkItem,
  updates: UpdatePlanningWorkItemInput
): UpdatePlanningWorkItemInput {
  const values: Record<string, unknown> = {}
  for (const key of RESTORABLE_KEYS) {
    if (!(key in updates)) continue
    if (key === 'fieldValues') {
      values.fieldValues = Object.fromEntries(
        Object.keys(updates.fieldValues ?? {}).map((id) => [id, task.fieldValues?.[id] ?? null])
      )
    } else values[key] = task[key] ?? null
  }
  return values as UpdatePlanningWorkItemInput
}

/** Only the fields an update may change come back through an undo. */
function restorableValues(values: unknown): UpdatePlanningWorkItemInput {
  if (!values || typeof values !== 'object') throw new Error('Send the values to put back')
  const result: Record<string, unknown> = {}
  for (const key of RESTORABLE_KEYS)
    if (key in values) result[key] = (values as Record<string, unknown>)[key]
  return result as UpdatePlanningWorkItemInput
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8').decode(bytes).replace(/^\ufeff/, '')) as unknown
  } catch {
    throw new Error(t('errors:importService.fileNotValidJson'))
  }
}

function isPackage(json: unknown): boolean {
  return (
    !!json &&
    typeof json === 'object' &&
    isProjectPackageFormat((json as Record<string, unknown>).format)
  )
}

/** Checks a package in full before anything is written. */
function requirePackage(json: unknown): ProjectPackage {
  const checked = validateProjectPackage(json)
  if (!checked.ok)
    throw new Error(t('errors:importService.projectFileCantImported', { error: checked.error }))
  return checked.value
}
