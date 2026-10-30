import fs from 'node:fs'
import type { ProjectIcon } from '@shared/project-icons'
import type { ProjectStage } from '@shared/project-stages'
import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import type {
  ImportSource,
  NewProjectFolder,
  NewProjectRequest,
  NewProjectResult,
  PlanningActor,
  ProjectPackageInclude,
  ProjectTemplateSummary,
  SaveProjectTemplateInput,
  WatchedProject,
  EstimateUnit,
  DemoKind
} from '@shared/ostler-api'
import { DEMO_KIND_BY_TEMPLATE } from '@shared/ostler-api'
import { todayIsoDate } from '@shared/dates'
import {
  PACKAGE_TEXT_KINDS,
  templateWhiteboard,
  validateProjectPackage,
  type PackageLibraryItem,
  type ProjectPackage
} from '@shared/project-package'
import { BUILT_IN_TEMPLATES } from '@shared/templates'
import { shiftDemoDates } from '@shared/demo-dates'
import { freeProjectName } from '@shared/project-names'
import type { PlanningService } from './planning-service'
import { deleteProjectRows } from './project-removal-service'
import { writeProjectArchive } from './project-archive'
import { encryptProjectFile, MIN_FILE_PASSWORD_LENGTH } from './protected-project-file'
import { t } from '@shared/i18n'
import { summarizeProjectPackage } from '@shared/project-package'
import { writePackageRecords } from './project-package-import'
import { buildProjectPackage } from './project-package-export'

/** A saved template's id: the name of its file in `<dataDir>/templates/`. */
const SAVED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_TEMPLATE_NAME = 80
const MAX_TEMPLATE_DESCRIPTION = 200

export interface CreateFromPackageOptions {
  name?: string
  color?: string
  /** The project's icon (N5.1); else the package's, if it has one. */
  icon?: ProjectIcon | null
  notes?: string
  tags?: string[]
  folder?: NewProjectFolder
  /** Shown in each task's activity: "Created from template '<name>'". */
  templateName?: string
  /**
   * Recorded as an import (P6.1): an `import_batches` row in the same
   * transaction, and each task's origin `imported` with the batch's id.
   */
  importBatch?: { id: string; source: ImportSource; fileName: string }
  /**
   * Keep the package's history (time, billings, rules, links, status
   * updates, contacts, baselines), as a project file does, though it comes
   * from a template: the demo projects. Left out, only project files keep it.
   */
  keepHistory?: boolean
  /** Made from a demo's built-in package: marks the project as that demo. */
  demo?: DemoKind
  /** The stage to start in (`NewProjectRequest.stage`); left out, Active. */
  stage?: ProjectStage
}

/**
 * An image object of an imported whiteboard waiting for its picture (D21): the file at
 * `libraryIndex` of the package, which the importer adds after the project is made.
 */
export interface PendingWhiteboardPicture {
  whiteboardId: string
  /** The object's new id. */
  objectId: string
  libraryIndex: number
}

/** A project made from a package; `pendingPictures` only when a whiteboard waits for one. */
export type CreatedFromPackage = NewProjectResult<WatchedProject> & {
  pendingPictures?: PendingWhiteboardPicture[]
}

/** A Library file a full export copies beside its package. */
export interface ExportedLibraryFile {
  /** `library/<name>`, as the package's item says. */
  file: string
  /** The stored original in the data folder. */
  sourcePath: string
}

export interface ExportPackageOptions {
  kind: 'template' | 'export'
  /** Dates become offsets from today (`+14d`), so a template starts when it is used. */
  relativeDates: boolean
  include?: ProjectPackageInclude
}

export interface ProjectPackageServiceDependencies {
  planning: PlanningService
  /**
   * Registers the project in `config.json` (and creates its folder, when
   * asked), with the id its records were written under. The last step.
   */
  registerProject(
    request: NewProjectRequest,
    fixed: { id: string; estimateUnit: EstimateUnit; taskPrefix?: string; demo?: DemoKind }
  ): Promise<NewProjectResult<WatchedProject>>
  /** A registered project, or throws. */
  getProject(projectId: string): WatchedProject
  /** Every registered project's name: a package's own name is proposed free of them. */
  projectNames?(): string[]
  dataDir: string
  appVersion: string
  /** The stored original of a Library item with a file (a full export copies it). */
  libraryFilePath?(projectId: string, itemId: string): string
  /** "Use AI agents" is on: a new project with a folder keeps Ready and In review (D34). */
  agentsOn?(): boolean
}

/**
 * Projects from packages and packages from projects (P5.8): the one
 * serializer for the project package format, which templates, the sample
 * project and P6.1's export and import share; `validateProjectPackage` is
 * the one parser. Also keeps the templates people save, as package files in
 * `<dataDir>/templates/`.
 *
 * Creating a project writes every record in one database transaction first,
 * then the config entry; if the config entry fails, the records go again, so
 * no half project is ever left behind.
 */
export class ProjectPackageService {
  constructor(private readonly deps: ProjectPackageServiceDependencies) {}

  private get templatesDir(): string {
    return path.join(this.deps.dataDir, 'templates')
  }

  // ─── Creating a project ───────────────────────────────────────────────────

  async createProjectFromPackage(
    pkg: ProjectPackage,
    options: CreateFromPackageOptions = {},
    today = todayIsoDate()
  ): Promise<CreatedFromPackage> {
    const checked = validateProjectPackage(pkg)
    if (!checked.ok) throw new Error(checked.error)
    const source = checked.value
    const pendingPictures: PendingWhiteboardPicture[] = []
    const actor: PlanningActor = options.importBatch
      ? this.deps.planning.humanActor()
      : {
          ...this.deps.planning.humanActor(),
          template: options.templateName ?? source.project.name
        }
    const created = await this.createProjectWithRecords(
      {
        name:
          options.name?.trim() ||
          freeProjectName(source.project.name, this.deps.projectNames?.() ?? []),
        color: options.color || source.project.color || '',
        icon: options.icon || source.project.icon || null,
        notes: options.notes ?? '',
        tags: options.tags ?? [],
        folder: options.folder ?? null,
        ...(options.stage !== undefined ? { stage: options.stage } : {})
      },
      source.project.estimateUnit,
      // A project file, a template or the sample project sets off no rules (D45).
      (projectId) =>
        this.deps.planning.withoutRules(() =>
          writePackageRecords(
            this.deps.planning,
            projectId,
            source,
            actor,
            today,
            options.importBatch,
            options.keepHistory ?? !options.templateName,
            (this.deps.agentsOn?.() ?? false) && (options.folder ?? null) !== null,
            options.demo !== undefined,
            pendingPictures
          )
        ),
      {
        // A project file keeps its task prefix (N9.8a); a template starts afresh.
        taskPrefix: options.templateName ? undefined : source.project.taskPrefix,
        demo: options.demo
      }
    )
    return pendingPictures.length > 0 ? { ...created, pendingPictures } : created
  }

  /**
   * A new project whose records `write` puts in, in one transaction, before
   * its config entry; if the entry fails, the records and the people `write`
   * created go again. Packages and imports into a new project (P6.1) share
   * it. `write` returns the ids of the people it created.
   */
  async createProjectWithRecords(
    request: NewProjectRequest,
    estimateUnit: EstimateUnit,
    write: (projectId: string) => string[],
    fixed: {
      /** A project file's task prefix (N9.8a), kept when no other project uses it. */
      taskPrefix?: string
      demo?: DemoKind
    } = {}
  ): Promise<NewProjectResult<WatchedProject>> {
    const projectId = uuidv4()
    const createdPeople = this.deps.planning.createRecordsForNewProject(projectId, () =>
      write(projectId)
    )
    try {
      return await this.deps.registerProject(request, {
        id: projectId,
        estimateUnit,
        ...(fixed.taskPrefix ? { taskPrefix: fixed.taskPrefix } : {}),
        ...(fixed.demo ? { demo: fixed.demo } : {})
      })
    } catch (error) {
      this.removeRecords(projectId, createdPeople)
      throw error
    }
  }

  async createProjectFromTemplate(
    templateId: string,
    request: Omit<CreateFromPackageOptions, 'templateName'>,
    today = todayIsoDate()
  ): Promise<NewProjectResult<WatchedProject>> {
    const pkg = this.getTemplatePackage(templateId)
    // A demo project comes with its history, dated as if its anchor were today.
    const demo = BUILT_IN_TEMPLATES.find((entry) => entry.id === templateId)?.demo
    return this.createProjectFromPackage(
      demo ? shiftDemoDates(pkg, demo.anchor, today) : pkg,
      {
        ...request,
        templateName: pkg.project.name,
        ...(demo ? { keepHistory: true } : {}),
        ...(DEMO_KIND_BY_TEMPLATE[templateId] ? { demo: DEMO_KIND_BY_TEMPLATE[templateId] } : {})
      },
      today
    )
  }

  /** Undoes a creation whose config entry failed: its rows, and the people it added. */
  private removeRecords(projectId: string, createdPeople: string[]): void {
    const db = this.deps.planning.database
    try {
      deleteProjectRows(db, projectId)
      const remove = db.prepare('DELETE FROM people WHERE id = ?')
      db.transaction(() => createdPeople.forEach((id) => remove.run(id)))()
    } catch (error) {
      console.error(`Could not clean up the records of project ${projectId}:`, error)
    }
  }

  // ─── Exporting a project ──────────────────────────────────────────────────

  /**
   * The project as a package. A template drops comments, activity, agent
   * links and completed state (Done tasks go back to the backlog, ticks are
   * cleared); P6.1's full export builds on the `export` kind. Like a written
   * file or template, a package too large to import again is refused.
   */
  exportProjectAsPackage(
    projectId: string,
    options: ExportPackageOptions,
    today = todayIsoDate()
  ): ProjectPackage {
    const { pkg } = buildProjectPackage(this.deps, projectId, options, today)
    refuseUnimportable(pkg)
    return pkg
  }

  /**
   * A full export (P6.1, one file since D29): `<name>.ostler-project`, a zip
   * holding `project.json` (the package, kind `export`) and `library/` (the
   * original files), the layout an export folder had. Nothing is written
   * anywhere but `filePath`.
   */
  exportProjectFile(
    projectId: string,
    filePath: string,
    options: { comments?: boolean; password?: string } = {}
  ): { filePath: string; taskCount: number; fileCount: number } {
    const password = options.password
    if (
      password !== undefined &&
      (typeof password !== 'string' || password.length < MIN_FILE_PASSWORD_LENGTH)
    )
      throw new Error(t('errors:protectedFile.passwordTooShort', { min: MIN_FILE_PASSWORD_LENGTH }))
    const { pkg, files } = buildProjectPackage(this.deps, projectId, {
      kind: 'export',
      relativeDates: false,
      include: { comments: options.comments !== false }
    })
    refuseUnimportable(pkg)
    const sources = [
      { name: 'project.json', text: `${JSON.stringify(pkg, null, 2)}\n` },
      ...files.map((entry) => ({ name: entry.file, filePath: entry.sourcePath }))
    ]
    if (password === undefined) {
      writeProjectArchive(filePath, sources)
    } else {
      // Protected (N45): the plain zip is written under the data folder, encrypted to the chosen file, then removed.
      const plain = path.join(this.temporaryExportFolder(), `${uuidv4()}.zip`)
      try {
        writeProjectArchive(plain, sources)
        encryptProjectFile(plain, filePath, password)
      } finally {
        fs.rmSync(plain, { force: true })
      }
    }
    return { filePath, taskCount: pkg.tasks.length, fileCount: files.length }
  }

  private temporaryExportFolder(): string {
    const folder = path.join(this.deps.dataDir, 'temp', 'exports')
    fs.mkdirSync(folder, { recursive: true })
    return folder
  }

  /**
   * The project file written to a new path under the data folder, for the
   * automation API to send; the caller removes it once sent.
   */
  exportProjectTemporaryFile(
    projectId: string,
    options: { comments?: boolean; password?: string } = {}
  ): string {
    const filePath = path.join(this.temporaryExportFolder(), `${uuidv4()}.ostler-project`)
    this.exportProjectFile(projectId, filePath, options)
    return filePath
  }

  // ─── Templates ────────────────────────────────────────────────────────────

  /** Built-in templates, in their order, then saved ones, newest first. */
  listTemplates(): ProjectTemplateSummary[] {
    const builtIn = BUILT_IN_TEMPLATES.flatMap(({ id, json }) => {
      const checked = validateProjectPackage(json)
      if (!checked.ok) {
        console.error(`Built-in template ${id} is not a valid package: ${checked.error}`)
        return []
      }
      return [summaryOf(id, 'built-in', checked.value)]
    })
    return [...builtIn, ...this.savedTemplates().map(({ id, pkg }) => summaryOf(id, 'saved', pkg))]
  }

  getTemplatePackage(templateId: string): ProjectPackage {
    const builtIn = BUILT_IN_TEMPLATES.find((entry) => entry.id === templateId)
    const json = builtIn ? builtIn.json : this.readSaved(templateId)
    const checked = validateProjectPackage(json)
    if (!checked.ok)
      throw new Error(t('errors:projectPackageService.templateCantUsed', { error: checked.error }))
    return checked.value
  }

  /** "Save as template…": the project as a template in `<dataDir>/templates/`. */
  saveProjectAsTemplate(
    projectId: string,
    input: SaveProjectTemplateInput,
    today = todayIsoDate()
  ): ProjectTemplateSummary {
    const name = templateName(input?.name)
    const description = templateDescription(input?.description)
    const pkg = this.exportProjectAsPackage(
      projectId,
      { kind: 'template', relativeDates: input?.relativeDates !== false, include: input?.include },
      today
    )
    pkg.project.name = name
    pkg.template = { description, icon: 'file' }
    refuseUnimportable(pkg)
    const id = uuidv4()
    this.writeSaved(id, pkg)
    return summaryOf(id, 'saved', pkg)
  }

  /**
   * "Import template…" (P6.1): a package file, checked in full, kept as a
   * saved template. Like any template it carries text and whiteboards only: no
   * comments, no Library files and no pictures on its whiteboards (D21).
   */
  importTemplate(json: unknown): ProjectTemplateSummary {
    const checked = validateProjectPackage(json)
    if (!checked.ok) throw new Error(checked.error)
    const pkg: ProjectPackage = {
      ...checked.value,
      comments: [],
      library: checked.value.library.flatMap((item): PackageLibraryItem[] => {
        if (item.whiteboard) return [{ ...item, whiteboard: templateWhiteboard(item.whiteboard) }]
        return PACKAGE_TEXT_KINDS.includes(item.kind) ? [item] : []
      }),
      template: checked.value.template ?? { description: 'Imported from a file.', icon: 'file' }
    }
    const id = uuidv4()
    this.writeSaved(id, pkg)
    return summaryOf(id, 'saved', pkg)
  }

  renameTemplate(templateId: string, name: string): ProjectTemplateSummary {
    const pkg = this.savedPackage(templateId)
    pkg.project.name = templateName(name)
    this.writeSaved(templateId, pkg)
    return summaryOf(templateId, 'saved', pkg)
  }

  /** Deletes a saved template; what it returns puts it back (`restoreTemplate`). */
  deleteTemplate(templateId: string): ProjectPackage {
    const pkg = this.savedPackage(templateId)
    fs.rmSync(this.savedPath(templateId), { force: true })
    return pkg
  }

  restoreTemplate(templateId: string, json: unknown): ProjectTemplateSummary {
    if (typeof templateId !== 'string' || !SAVED_ID.test(templateId))
      throw new Error(t('errors:projectPackageService.templateNotFound'))
    const checked = validateProjectPackage(json)
    if (!checked.ok) throw new Error(checked.error)
    if (fs.existsSync(this.savedPath(templateId)))
      throw new Error(t('errors:projectPackageService.templateAlreadyExists'))
    this.writeSaved(templateId, checked.value)
    return summaryOf(templateId, 'saved', checked.value)
  }

  /** The template's package file, as text, for "Export file…". */
  templateFileText(templateId: string): { name: string; text: string } {
    const pkg = this.getTemplatePackage(templateId)
    return { name: pkg.project.name, text: `${JSON.stringify(pkg, null, 2)}\n` }
  }

  private savedPath(templateId: string): string {
    return path.join(this.templatesDir, `${templateId}.json`)
  }

  private readSaved(templateId: string): unknown {
    if (typeof templateId !== 'string' || !SAVED_ID.test(templateId))
      throw new Error('Template not found')
    try {
      return JSON.parse(fs.readFileSync(this.savedPath(templateId), 'utf8')) as unknown
    } catch {
      throw new Error('Template not found')
    }
  }

  private savedPackage(templateId: string): ProjectPackage {
    const checked = validateProjectPackage(this.readSaved(templateId))
    if (!checked.ok)
      throw new Error(t('errors:projectPackageService.templateCantUsed', { error: checked.error }))
    return checked.value
  }

  private writeSaved(templateId: string, pkg: ProjectPackage): void {
    fs.mkdirSync(this.templatesDir, { recursive: true })
    const target = this.savedPath(templateId)
    const temporary = `${target}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    fs.renameSync(temporary, target)
  }

  private savedTemplates(): { id: string; pkg: ProjectPackage; savedAt: number }[] {
    let names: string[] = []
    try {
      names = fs.readdirSync(this.templatesDir)
    } catch {
      return []
    }
    return names
      .flatMap((file) => {
        const id = file.replace(/\.json$/, '')
        if (!file.endsWith('.json') || !SAVED_ID.test(id)) return []
        try {
          const checked = validateProjectPackage(this.readSaved(id))
          if (!checked.ok) return []
          return [{ id, pkg: checked.value, savedAt: fs.statSync(this.savedPath(id)).mtimeMs }]
        } catch {
          return []
        }
      })
      .sort((a, b) => b.savedAt - a.savedAt)
  }
}

function summaryOf(
  id: string,
  source: ProjectTemplateSummary['source'],
  pkg: ProjectPackage
): ProjectTemplateSummary {
  return {
    id,
    source,
    name: pkg.project.name,
    description: pkg.template?.description ?? '',
    icon: pkg.template?.icon ?? 'file',
    ...summarizeProjectPackage(pkg)
  }
}

function templateName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(t('errors:projectPackageService.giveTemplateName'))
  if (value.trim().length > MAX_TEMPLATE_NAME)
    throw new Error(t('errors:projectPackageService.templateNameCanMost', { MAX_TEMPLATE_NAME }))
  return value.trim()
}

function templateDescription(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Saved from a project.'
  if (typeof value !== 'string') throw new Error('The description must be text')
  if (value.trim().length > MAX_TEMPLATE_DESCRIPTION)
    throw new Error(
      t('errors:projectPackageService.descriptionCanMostCharacters', { MAX_TEMPLATE_DESCRIPTION })
    )
  return value.trim() || 'Saved from a project.'
}

/**
 * Refuses to write a package that import, or the template list, would refuse
 * (too many tasks or too much text, for instance): the same check, before the
 * file is made.
 */
function refuseUnimportable(pkg: ProjectPackage): void {
  const checked = validateProjectPackage(pkg)
  if (!checked.ok) throw new Error(checked.error)
}
