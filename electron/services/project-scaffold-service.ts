import * as fs from 'fs'
import { normalizeProjectIcon, type ProjectIcon } from '@shared/project-icons'
import * as path from 'path'
import simpleGit from 'simple-git'
import type {
  DemoKind,
  EstimateUnit,
  NewProjectDefaults,
  NewProjectGitignoreTemplate,
  NewProjectLocationCheck,
  NewProjectRequest,
  NewProjectResult,
  NewProjectScaffold,
  WatchedProject
} from '@shared/ostler-api'
import type { ConfigStore } from '../config-store'
import { projectFolder } from '@shared/project-folder'
import { normalizeAndResolve, sanitizePath } from '../paths'
import { t } from '@shared/i18n'

const MAX_NAME_LENGTH = 80
const MAX_FOLDER_NAME_LENGTH = 100
const MAX_TAGS = 12
const MAX_TAG_LENGTH = 32

// Names Windows refuses for a file or folder regardless of extension.
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
// Windows also forbids the ASCII control characters U+0000-U+001F in names, so matching them is the point.
// eslint-disable-next-line no-control-regex
const INVALID_FOLDER_CHARS = /[<>:"/\\|?*\u0000-\u001f]/

const GITIGNORE_TEMPLATES: Record<Exclude<NewProjectGitignoreTemplate, 'none'>, string> = {
  general: ['.DS_Store', 'Thumbs.db', '*.log', '.env', '.env.*', '!.env.example', ''].join('\n'),
  node: [
    'node_modules/',
    'dist/',
    'out/',
    'coverage/',
    '*.log',
    '.env',
    '.env.*',
    '!.env.example',
    '.DS_Store',
    'Thumbs.db',
    ''
  ].join('\n'),
  python: [
    '__pycache__/',
    '*.py[cod]',
    '.venv/',
    'venv/',
    '.pytest_cache/',
    '*.egg-info/',
    'build/',
    'dist/',
    '.env',
    '.DS_Store',
    'Thumbs.db',
    ''
  ].join('\n'),
  // C#, F# and VB on .NET, with Visual Studio: build output never belongs in
  // Git, and an agent's rescue commit takes whatever is not ignored.
  dotnet: [
    'bin/',
    'obj/',
    '.vs/',
    '*.user',
    '*.suo',
    'TestResults/',
    'publish/',
    '*.log',
    '.env',
    '.DS_Store',
    'Thumbs.db',
    ''
  ].join('\n')
}

/**
 * Validates a folder name the way the filesystem would, so the wizard can say
 * what is wrong instead of surfacing a raw ENOENT/EINVAL after the fact.
 */
export function folderNameProblem(folderName: string): string | null {
  if (!folderName) return t('errors:projectScaffoldService.enterFolderName')
  if (folderName.length > MAX_FOLDER_NAME_LENGTH) {
    return t('errors:projectScaffoldService.folderNamesLimitedCharacters', {
      MAX_FOLDER_NAME_LENGTH
    })
  }
  if (folderName === '.' || folderName === '..')
    return t('errors:projectScaffoldService.notUsableFolderName')
  if (INVALID_FOLDER_CHARS.test(folderName)) {
    return 'Folder names cannot contain < > : " / \\ | ? * or control characters.'
  }
  if (/[. ]$/.test(folderName)) return t('errors:projectScaffoldService.folderNamesCannotEnd')
  if (WINDOWS_RESERVED_NAMES.test(folderName.split('.')[0])) {
    return t('errors:projectScaffoldService.reservedWindows', { folderName })
  }
  return null
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  for (const tag of tags) {
    if (typeof tag !== 'string') continue
    const cleaned = tag.trim().slice(0, MAX_TAG_LENGTH)
    if (cleaned) seen.add(cleaned)
    if (seen.size >= MAX_TAGS) break
  }
  return [...seen]
}

/**
 * Creates projects, the one way a project comes into Ostler (D4): with no
 * folder, with a folder that already exists (validated and checked for
 * nesting, never written to), or with a brand-new folder on the human's
 * explicit request.
 *
 * The new-folder path is a deliberate, narrow exception to "project Git is read-only": it only
 * ever runs `git init` (and one optional commit) inside a folder Ostler itself
 * just created, or an empty one the human picked. It never touches an existing
 * repository, and it never runs automatically or on an agent's behalf.
 */
export class ProjectScaffoldService {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly getDocumentsPath: () => string
  ) {}

  async getDefaults(): Promise<NewProjectDefaults> {
    const git = simpleGit()
    let gitAvailable = false
    try {
      gitAvailable = (await git.version()).installed !== false
    } catch {
      gitAvailable = false
    }

    let gitIdentityConfigured = false
    if (gitAvailable) {
      try {
        const [name, email] = await Promise.all([
          git.raw(['config', 'user.name']),
          git.raw(['config', 'user.email'])
        ])
        gitIdentityConfigured = name.trim().length > 0 && email.trim().length > 0
      } catch {
        // `git config <key>` exits non-zero when the key is unset.
        gitIdentityConfigured = false
      }
    }

    return {
      parentPath: this.suggestParentPath(),
      gitAvailable,
      gitIdentityConfigured,
      colors: this.configStore.getProjectColors()
    }
  }

  /** Keeps new projects next to the last one, which is where the human keeps them. */
  private suggestParentPath(): string {
    const projects = this.configStore.getProjects()
    for (let index = projects.length - 1; index >= 0; index--) {
      const folder = projectFolder(projects[index])
      if (folder === null) continue
      const parent = path.dirname(folder)
      try {
        if (fs.statSync(parent).isDirectory()) return parent
      } catch {
        // The parent is gone; try the next most recent project.
      }
    }
    return this.getDocumentsPath()
  }

  checkLocation(parentPath: string, folderName: string): NewProjectLocationCheck {
    const trimmedParent = (parentPath ?? '').trim()
    const trimmedName = (folderName ?? '').trim()
    const nameProblem = folderNameProblem(trimmedName)

    if (!trimmedParent) {
      return {
        projectPath: '',
        problem: t('errors:projectScaffoldService.chooseWhereProjectFolder')
      }
    }
    const resolvedParent = normalizeAndResolve(sanitizePath(trimmedParent))
    const projectPath = nameProblem ? resolvedParent : path.join(resolvedParent, trimmedName)

    if (!path.isAbsolute(trimmedParent)) {
      return { projectPath, problem: t('errors:projectScaffoldService.locationMustAbsolutePath') }
    }
    try {
      if (!fs.statSync(resolvedParent).isDirectory()) {
        return {
          projectPath,
          problem: t('errors:projectScaffoldService.notFolder', { resolvedParent })
        }
      }
    } catch {
      return {
        projectPath,
        problem: t('errors:projectScaffoldService.doesNotExist', { resolvedParent })
      }
    }
    if (nameProblem) return { projectPath, problem: nameProblem }

    if (fs.existsSync(projectPath)) {
      const stat = fs.statSync(projectPath)
      if (!stat.isDirectory()) {
        return {
          projectPath,
          problem: t('errors:projectScaffoldService.alreadyExistsFile', { projectPath })
        }
      }
      if (fs.readdirSync(projectPath).length > 0) {
        return {
          projectPath,
          problem: t('errors:projectScaffoldService.alreadyExistsNotEmpty', { projectPath })
        }
      }
    }

    try {
      this.configStore.assertNoWatchedOverlap(projectPath)
    } catch (error) {
      return { projectPath, problem: error instanceof Error ? error.message : String(error) }
    }
    return { projectPath, problem: null }
  }

  /** `fixed` is set when the project's records were written first (P5.8). */
  async createProject(
    request: NewProjectRequest,
    fixed: { id?: string; estimateUnit?: EstimateUnit; taskPrefix?: string; demo?: DemoKind } = {}
  ): Promise<NewProjectResult<WatchedProject>> {
    const name = (request?.name ?? '').trim()
    if (!name) throw new Error(t('errors:projectScaffoldService.projectNameRequired'))
    if (name.length > MAX_NAME_LENGTH) {
      throw new Error(
        t('errors:projectScaffoldService.projectNamesLimitedCharacters', { MAX_NAME_LENGTH })
      )
    }
    const details = {
      name,
      color: /^#[0-9a-f]{6}$/i.test(request.color ?? '') ? request.color : undefined,
      notes: typeof request.notes === 'string' ? request.notes.trim() : '',
      tags: normalizeTags(request.tags),
      icon: normalizeProjectIcon(request.icon),
      // Checked by `registerProject`, the one place a new project's stage is set.
      ...(request.stage !== undefined ? { stage: request.stage } : {}),
      ...fixed
    }
    const folder = request.folder ?? null
    const empty = { createdFiles: [], gitInitialized: false, committed: false, warnings: [] }

    if (folder === null) {
      return { project: this.configStore.registerProject({ ...details, folder: null }), ...empty }
    }
    if (folder.kind === 'existing') {
      // Validated exactly as linking validates it; nothing is written to it.
      const resolved = this.configStore.validateProjectFolder(folder.path)
      return {
        project: this.configStore.registerProject({ ...details, folder: resolved }),
        ...empty
      }
    }
    if (folder.kind !== 'new')
      throw new Error(t('errors:projectScaffoldService.chooseWhereProjectLives'))
    return this.createInNewFolder(details, folder)
  }

  private async createInNewFolder(
    details: {
      name: string
      color?: string
      notes: string
      tags: string[]
      id?: string
      estimateUnit?: EstimateUnit
      icon?: ProjectIcon | null
      taskPrefix?: string
    },
    request: NewProjectScaffold
  ): Promise<NewProjectResult<WatchedProject>> {
    const { name } = details
    const folderName = (request.folderName ?? '').trim()
    const check = this.checkLocation(request.parentPath, folderName)
    if (check.problem) throw new Error(check.problem)
    const projectPath = check.projectPath

    const description = details.notes
    const warnings: string[] = []
    const createdFiles: string[] = []

    const existedBefore = fs.existsSync(projectPath)
    if (!existedBefore) fs.mkdirSync(projectPath)

    let gitInitialized = false
    let committed = false
    try {
      const writeFile = (relativePath: string, content: string) => {
        fs.writeFileSync(path.join(projectPath, relativePath), content, { flag: 'wx' })
        createdFiles.push(relativePath)
      }
      if (request.addReadme) {
        writeFile('README.md', description ? `# ${name}\n\n${description}\n` : `# ${name}\n`)
      }
      const template = request.gitignore
      if (template && template !== 'none' && GITIGNORE_TEMPLATES[template]) {
        writeFile('.gitignore', GITIGNORE_TEMPLATES[template])
      }

      // Git runs before the project is registered so the watcher's first view
      // of the folder is its settled state, not a burst of init/commit events.
      if (request.initGit) {
        const git = simpleGit(projectPath)
        try {
          try {
            await git.raw(['init', '-b', 'main'])
          } catch {
            // `-b` needs Git 2.28; older installs take the default branch name.
            await git.init()
          }
          gitInitialized = true
        } catch (error) {
          warnings.push(
            t('errors:projectScaffoldService.gitCouldNotInitialize', {
              message: error instanceof Error ? error.message : String(error)
            })
          )
        }

        if (gitInitialized && request.initialCommit) {
          try {
            await git.add('.')
            // --allow-empty: agent sessions fork from HEAD, so a repository
            // with no scaffolded files still needs a first commit.
            await git.raw(['commit', '--allow-empty', '-m', 'Initial commit'])
            committed = true
          } catch (error) {
            warnings.push(
              t('errors:projectScaffoldService.repositoryWasCreatedBut', {
                message: error instanceof Error ? error.message : String(error)
              })
            )
          }
        }
      }

      const project = this.configStore.registerProject({ ...details, folder: projectPath })
      return { project, createdFiles, gitInitialized, committed, warnings }
    } catch (error) {
      this.rollback(projectPath, existedBefore, createdFiles, gitInitialized)
      throw error
    }
  }

  /** Undoes only what `create` itself put on disk. */
  private rollback(
    projectPath: string,
    existedBefore: boolean,
    createdFiles: string[],
    gitInitialized: boolean
  ): void {
    try {
      if (!existedBefore) {
        fs.rmSync(projectPath, { recursive: true, force: true })
        return
      }
      for (const file of createdFiles) fs.rmSync(path.join(projectPath, file), { force: true })
      if (gitInitialized)
        fs.rmSync(path.join(projectPath, '.git'), { recursive: true, force: true })
    } catch {
      // Best effort: the original error is the one worth reporting.
    }
  }
}
