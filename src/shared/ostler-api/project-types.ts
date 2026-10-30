import type { AgentUsageLimits, ProjectAutoDispatchConfig } from './harness-types'
import type { AgentSetupSetting } from '../workspace-setup'
import type { EstimateUnit } from './people-types'
import type { ProjectIcon } from '../project-icons'
import type { ProjectStage } from '../project-stages'
import type { UpdateReminder } from '../status-updates'

// ─── Project Types ──────────────────────────────────────────────────────────

export interface WatchedProject {
  id: string
  name: string
  /** The linked folder, or null for a project that lives only in Ostler (D4). Read it through `projectFolder` or `requireProjectFolder`. */
  path: string | null
  color: string
  enabled: boolean
  customIgnorePatterns: string[]
  notes: string
  tags: string[]
  addedAt: number
  lastActivity: number | null
  /** Optional, human-issued bearer token for the loopback automation API. */
  automationToken?: string
  /** Per-project automatic dispatcher configuration for embedded agent sessions. */
  autoDispatch?: ProjectAutoDispatchConfig
  /** How this project's task estimates count (D22). Config migration 6 sets `'points'`. */
  estimateUnit?: EstimateUnit
  /** Whether Ostler AI plans for coding agents or for people. Config migration 8 writes 'auto'; read it through `projectAiProfile`. */
  aiProfile?: 'auto' | 'software' | 'general'
  /** Owner-written markdown every coding agent on this project receives (D25). Config migration 9 writes ''; read it through `resolveProjectConventions`. */
  agentConventions?: string
  /**
   * How a new agent workspace is prepared before the agent starts (dependency
   * install). Missing means `auto`. Read it through `resolveWorkspaceSetup`.
   * Never exposed on the harness API: a coding agent must not choose the
   * command Ostler runs.
   */
  agentSetup?: AgentSetupSetting
  /**
   * Token limits per day and per month for the built-in agent (R5.3, D43).
   * Config migration 17 writes none; read it through `normalizeAgentLimits`.
   * Set in the app only: the automation API can read them, never change them.
   */
  agentLimits?: AgentUsageLimits
  /**
   * The project's GitHub repository as `owner/repo` (R4.4, D40), or '' for
   * none: what a `#123` link and Import from GitHub issues mean. Config
   * migration 18 writes ''. Saved through `normalizeGithubRepositorySetting`.
   */
  githubRepository?: string
  /**
   * The area this project is in (N5.1, N36), an id in `config.areas`, or
   * null for "No area". Config migration 23 writes null.
   */
  areaId?: string | null
  /** An icon from the curated set beside the colour (N5.1), or null. Config migration 23 writes null. */
  icon?: ProjectIcon | null
  /**
   * Where the project is in its life (N5.3, N38): Home's board of projects.
   * On hold and Done step out of the daily lists (`isProjectInPlay`); it is
   * not archiving and not `enabled`. Config migration 28 writes 'active'.
   */
  stage?: ProjectStage
  /**
   * The reminder to post a status update (N5.5, N40): off, weekly or
   * fortnightly, on a weekday. Config migration 29 writes it off; read it
   * through `normalizeUpdateReminder`.
   */
  updateReminder?: UpdateReminder
  /**
   * Triage new captures (N4.3a, N33): quick add, Snip to task, tasks from
   * text and the automation API (when it asks) put new tasks in To triage
   * instead of the Backlog. Config migration 34 writes false; read it
   * through `triageOn` (`electron/services/triage-service.ts`).
   */
  triageCaptures?: boolean
  /**
   * Try it's command (N9.4, N62), such as `npm run dev`: one line, run in a
   * finished task's copy when the person clicks Try it. '' is none. Config
   * migration 31 writes ''. Set in the app only, through `parseTryCommand`:
   * never by an agent, never through the automation API, and it does not
   * travel with the project file.
   */
  tryCommand?: string
  /** Whether the person has seen Try it's warning in this project. Config migration 31 writes false. */
  tryItWarningSeen?: boolean
  /**
   * Lessons from earlier reviews (N9.6a, N64): rules the person saved after
   * sending work back, read by agents after the conventions through
   * `resolveProjectConventions`. Config migration 32 writes []. Changed only
   * through `src/shared/project-lessons.ts`; like the conventions, they stay
   * with this project and do not travel with the project file.
   */
  agentLessons?: ProjectLesson[]
  /**
   * The prefix of the project's task IDs (N9.8a, N66): two to five capital
   * letters, unique among projects, so its tasks read as SHOP-12. Config
   * migration 33 writes one from each project's name; changed through
   * `ConfigStore.updateProject`, which checks it with `parseTaskPrefix`.
   */
  taskPrefix?: string
  /**
   * Which demo project this is, set by main when a demo is made from its
   * built-in package (config migration 44 tags the demos made before). A
   * copy opened from a backup or a project file is not a demo. The renderer
   * cannot set it (`PROTECTED_PROJECT_FIELDS`).
   */
  demo?: DemoKind
}

/** The two demo projects: the simple one, a weekend away, and the advanced one, a café refit. */
export type DemoKind = 'simple' | 'advanced'

/** One lesson (N9.6a): at most 500 characters, at most 100 per project. */
export interface ProjectLesson {
  id: string
  text: string
  /** Off keeps the lesson but agents no longer read it. */
  enabled: boolean
  /** When it was added, in ms. */
  addedAt: number
  /** The send-back it came from, or null for one written in settings or through the API. */
  source: { sessionId: string; taskTitle: string } | null
}

/** The longest project conventions text a project may hold (D25). */
export const MAX_PROJECT_CONVENTIONS_LENGTH = 20_000

/**
 * A project as the renderer sees it: no token. The automation token stays in
 * the main process (built by `toRendererProject`); a screen that must show it
 * asks for it with `revealProjectToken`.
 */
export type RendererProject = Omit<WatchedProject, 'automationToken'> & {
  hasAutomationToken: boolean
}

/** What the renderer may change on a project: never its id, tokens or folder. */
export type RendererProjectUpdate = Partial<Omit<WatchedProject, 'id' | 'path' | 'automationToken'>>

/** Which project token a reveal or copy call means: agents have per-task passwords (§2.3). */
export type ProjectTokenKind = 'automation'

/** The two ways an AI assistant connects over MCP (D39). */
export type McpClientForm = 'http' | 'stdio'

/**
 * How to connect an AI assistant to a project over MCP, for Settings ›
 * Connections. The HTTP configuration carries the token, so it is masked;
 * Copy has main build the full text.
 */
export interface McpConnection {
  url: string
  /** The stdio launcher as one command line. */
  command: string
  httpConfig: string
  stdioConfig: string
}

export interface ProjectRemoval {
  /**
   * `ostler/*` versions left in the project's own repository after its agent
   * copies were removed. Removing a project never deletes work an agent did,
   * so the interface reports these rather than silently dropping them.
   */
  retainedBranches: string[]
}

// ─── New Project Types ──────────────────────────────────────────────────────

export type NewProjectGitignoreTemplate = 'none' | 'general' | 'node' | 'python' | 'dotnet'

/**
 * Where a new project lives (D4): only in Ostler (`null`), in a folder that
 * already exists, or in a new folder Ostler creates and may `git init`.
 */
export type NewProjectFolder =
  null | { kind: 'existing'; path: string } | ({ kind: 'new' } & NewProjectScaffold)

/** What the "New project" wizard asks for. */
export interface NewProjectRequest {
  /** Display name shown in Ostler. */
  name: string
  color: string
  tags: string[]
  /** Saved as the project's notes; also the README text for a new folder. */
  notes: string
  folder: NewProjectFolder
  /** Start from this template (`ProjectTemplateSummary.id`); absent for a blank project (P5.8). */
  templateId?: string
  /** An icon from the curated set (N5.1), or none. */
  icon?: ProjectIcon | null
  /** The stage to start in; left out, Active. */
  stage?: ProjectStage
}

/** How a brand-new project folder is created (`folder.kind === 'new'`). */
export interface NewProjectScaffold {
  /** Existing directory the project folder is created inside. */
  parentPath: string
  /** Name of the new folder inside `parentPath`. */
  folderName: string
  /** Run `git init` in the new folder. Agent sessions need a Git repository. */
  initGit: boolean
  addReadme: boolean
  gitignore: NewProjectGitignoreTemplate
  /** Commit the scaffolded files. Only meaningful with `initGit`. */
  initialCommit: boolean
}

/** Environment facts the wizard needs before it asks anything. */
export interface NewProjectDefaults {
  parentPath: string
  gitAvailable: boolean
  /** True when `user.name` and `user.email` resolve, so an initial commit can succeed. */
  gitIdentityConfigured: boolean
  colors: string[]
}

/** Verdict on a prospective `parentPath` + `folderName`; `problem` is user-facing. */
export interface NewProjectLocationCheck {
  projectPath: string
  problem: string | null
}

export interface NewProjectResult<TProject = RendererProject> {
  project: TProject
  createdFiles: string[]
  gitInitialized: boolean
  committed: boolean
  /** The project exists, but one optional step did not complete. */
  warnings: string[]
}

// ─── Watcher Types ──────────────────────────────────────────────────────────

export type FileChangeType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export type FileCategory =
  | 'source'
  | 'style'
  | 'markup'
  | 'config'
  | 'documentation'
  | 'build'
  | 'test'
  | 'media'
  | 'dependency'
  | 'other'

export interface WatchEvent {
  id: string
  projectId: string
  timestamp: number
  type: FileChangeType
  relativePath: string
  extension: string
  sizeBytes: number | null
  category: FileCategory
}

export interface WatcherStatus {
  running: boolean
  projects: {
    projectId: string
    watching: boolean
    eventCount: number
    lastEvent: number | null
    error: string | null
  }[]
}

export interface EventQuery {
  projectId?: string
  category?: FileCategory
  type?: FileChangeType
  since?: number
  until?: number
  search?: string
  limit?: number
  offset?: number
}

export interface EventStats {
  totalEvents: number
  eventsByCategory: Record<FileCategory, number>
  eventsByType: Record<FileChangeType, number>
  hotFiles: { path: string; count: number }[]
  eventsPerHour: { hour: number; count: number }[]
}

export interface ExportOptions {
  projectId?: string
  since?: number
  until?: number
  format: 'json' | 'csv'
}

// ─── Git Types ──────────────────────────────────────────────────────────────

export interface GitCommit {
  hash: string
  abbreviatedHash: string
  /** First line of the commit message. */
  message: string
  /** Remaining commit-message text, retained for project-history context. */
  body: string
  author: string
  date: string
  filesChanged: number
  insertions: number
  deletions: number
  /**
   * Relative paths of files touched by this commit, when available from the
   * stat-annotated log. Omitted for commits sourced from persisted event
   * history, which only retains aggregate counts.
   */
  changedFiles?: string[]
}

/**
 * A commit whose message names a task's ID (N9.8b): what the task's Commits
 * section and `GET /work-items/:workItemId/commits` show. `fixes` is true when
 * the message said it fixes the task ("Fixes SHOP-12").
 */
export interface TaskCommit {
  hash: string
  abbreviatedHash: string
  /** The commit's first line, as Git has it: plain text, never markup. */
  subject: string
  author: string
  /** ISO date of the commit. */
  date: string
  fixes: boolean
}

export interface GitGraphRef {
  /** Branch/tag name, with any `HEAD -> `/`tag: ` decoration prefix stripped from branch names. */
  name: string
  isHead: boolean
  /** True for Ostler-owned `nexus/session/*` or `nexus/merge-review/*` branches. */
  isSessionBranch: boolean
}

export interface GitGraphCommit {
  hash: string
  abbreviatedHash: string
  /** Parent commit hashes, in Git's order (first parent first). Empty for a root commit. */
  parents: string[]
  refs: GitGraphRef[]
  author: string
  date: string
  /** First line of the commit message. */
  message: string
}

export interface GitBranchGraph {
  projectId: string
  commits: GitGraphCommit[]
}

export interface GitProjectState {
  projectId: string
  isGitRepo: boolean
  currentBranch: string | null
  lastCommit: GitCommit | null
  workingTreeStatus: {
    modified: number
    untracked: number
    staged: number
    conflicted: number
  }
  recentCommits: GitCommit[]
  remoteUrl: string | null
}

/**
 * What Ostler holds for one project, gathered before removing it. Read-only:
 * building this deletes nothing and writes nothing.
 */
export interface ProjectRemovalInventory {
  projectId: string
  projectName: string
  /** The linked folder, or null for a project with none. */
  projectPath: string | null
  /** Per-table row counts, only for tables that actually hold rows. */
  rowCounts: { table: string; rows: number }[]
  totalRows: number
  /** Ostler's per-project harness directory, or null when it was never created. */
  harnessDir: string | null
  aiDirectories: string[]
  /** The project's Library files (`<dataDir>/library/<projectId>`), or null when there are none. */
  libraryDir: string | null
  /** Library items (rows in `library_items`, archived ones included). */
  libraryItemCount: number
  libraryFileCount: number
  libraryBytes: number
  /** Agent work kept as `ostler/*` versions in the project's own repository. */
  sessionBranches: string[]
  /**
   * Sessions Ostler still has open. `running` distinguishes an agent whose
   * process is alive right now from a record left behind by an app that
   * closed while the session was open - the second is a stale row, not work
   * in progress, and only the first is a reason to refuse removal.
   */
  openSessions: { id: string; title: string; lastSeenAt: string | null; running: boolean }[]
  runningSessions: number
  staleSessions: number
  reviewSessions: number
  /**
   * Where an archive would be written, inside the project's own folder; null
   * for a project with no folder, whose archive goes where the human chooses.
   */
  archiveRoot: string | null
  /** The database file the records are deleted from (the file itself stays). */
  databasePath: string
  /**
   * The folders removal deletes, each one that exists now, with what is in
   * it: all of them inside Ostler's data folder.
   */
  toDelete: ProjectRemovalFolder[]
  /** Record archives already written into the project's folder (`.ostler-archive`), newest first. */
  archives: { path: string; writtenAt: number }[]
}

/** One folder removal would delete. */
export interface ProjectRemovalFolder {
  kind: 'agentData' | 'taskCopies' | 'aiDrafts' | 'library'
  path: string
  fileCount: number
  bytes: number
}

/** Result of writing the project's Ostler-held records into its own folder. */
export interface ProjectRemovalArchive {
  archivePath: string
  files: { name: string; rows: number; bytes: number }[]
  /** Library files copied into `<archivePath>/library/`. */
  libraryFileCount: number
}

/** What a completed purge actually deleted. */
/**
 * The demo projects there are, archived ones too, and what the person added
 * to them since they were made: the one confirmation for removing both says
 * so when it is not nothing.
 */
export interface DemoProjectsStatus {
  projects: { id: string; name: string; kind: DemoKind; enabled: boolean }[]
  /** Tasks made in a demo after it was made. */
  addedTasks: number
  /** Comments written in a demo after it was made. */
  addedComments: number
  /**
   * Untouched since made: no task added or changed, no comment, and both
   * still called what they were made as. Only then are they offered again
   * in a new language.
   */
  untouched: boolean
}

export interface ProjectRemovalPurge {
  deletedRows: { table: string; rows: number }[]
  removedPaths: string[]
  /** Directories Ostler could not delete; the removal completed regardless. */
  failedPaths: { path: string; reason: string }[]
  retainedBranches: string[]
  /** Whether the project's Library folder was deleted. */
  libraryDirRemoved: boolean
}

/**
 * One backup of a single project: a project file (`.ostler-project`) under
 * `<dataDir>/project-backups/<projectId>/`, written by Back up this project.
 * It is kept when the project is removed, so it can be opened again.
 */
export interface ProjectBackupEntry {
  /** The file's name; the renderer sends this back, never a path. */
  id: string
  /** Where it is, to show the person (it stays there after the project is removed). */
  filePath: string
  /** Epoch milliseconds. */
  createdAt: number
  sizeBytes: number
  /** Whether a `.sha256` checksum file sits beside it. */
  hasChecksum: boolean
}

/** What checking a file against its `.sha256` checksum file found. */
export type ChecksumVerdict = 'matches' | 'differs' | 'missing'

/** A checksum file written beside a file the person chose. */
export interface ChecksumWritten {
  filePath: string
  checksumPath: string
  /** Lower-case hex SHA-256. */
  sha256: string
}

/** Records whose parent record is gone, in one table, for one project. */
export interface ProjectBrokenRecords {
  table: string
  rows: number
}

/**
 * Check this project's records: SQLite's own check of the database file (it
 * covers the whole file, since the file cannot be checked a project at a
 * time), and this project's records that point at something missing.
 */
export interface ProjectRecordsCheck {
  checkedAt: number
  /** True when SQLite's quick check found nothing wrong with the file. */
  databaseOk: boolean
  /** SQLite's own words for the first problems it found; empty when it is fine. */
  databaseProblems: string[]
  /** This project's records, by table. */
  totalRows: number
  tableCount: number
  brokenRecords: ProjectBrokenRecords[]
}

/** What Repair did: a backup first, then the fixes, then a fresh check. */
export interface ProjectRecordsRepair {
  /** The full backup made before anything changed (Settings › Data lists it). */
  backupId: string
  /** Records whose link to a missing record was cleared (the link is optional), by table. */
  clearedLinks: ProjectBrokenRecords[]
  /** Records removed because they cannot exist without what they belonged to, by table. */
  removedRecords: ProjectBrokenRecords[]
  /** Whether the database's indexes were rebuilt. */
  reindexed: boolean
  after: ProjectRecordsCheck
}
