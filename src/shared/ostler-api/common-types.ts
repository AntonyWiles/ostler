import type { BackupCopyStatus } from './backup-types'

// ─── Result Type ────────────────────────────────────────────────────────────

/** Structured result — no raw exceptions cross the IPC bridge. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

// ─── System Types ───────────────────────────────────────────────────────────

export interface DatabaseStats {
  sizeBytes: number
  watchEventCount: number
  gitEventCount: number
  harnessEventCount: number
  conversationCount: number
  oldestEvent: number | null
  /** The sync service the data folder is inside, when Ostler recognises one. */
  syncedBy: BackupCopyStatus['syncedBy']
}

export interface ProjectStateUpdate {
  projectId: string
  /**
   * What changed. `projects` means the project list or a project's config
   * (main sends it for every add, create, update, enable or disable, remove
   * and purge); `watcher` means the file watcher's status; `config` means a
   * settings change (projectId is empty); `ai` carries `{ activeRequests }`,
   * the model requests waiting for a response (projectId is empty); `people`
   * means the people list changed (projectId is empty: people are global);
   * `home` means something Home or the Inbox shows may have changed, from
   * any project (projectId is empty; P5.6); `columns` means a project's
   * column names or hidden columns changed (R2.4); `daysOff` means the days
   * off changed (N3.2; projectId is empty: they are global); `calendars`
   * means an outside calendar or its events changed (N3.3a; global).
   * Listeners reload only what the field names.
   */
  field:
    | 'projects'
    | 'config'
    | 'ai'
    | 'git'
    | 'harness'
    | 'watcher'
    | 'activity'
    | 'improvementReview'
    | 'planning'
    | 'taskReview'
    | 'library'
    | 'people'
    /** Teams changed (D1): the Teams list and Workload's team filter read them again. */
    | 'teams'
    /** The contact list changed (N6.5): the Contacts view and pickers read it again. */
    | 'contacts'
    | 'daysOff'
    | 'calendars'
    | 'home'
    | 'columns'
    /** Undo history gained, lost or undid a step (projectId is empty). */
    | 'history'
    /** A project's sharing state changed (shared-folder sync). */
    | 'sharing'
  data: unknown
}

// ─── Code Workspace Types ───────────────────────────────────────────────────

export interface CodeDirEntry {
  name: string
  relativePath: string
  isDirectory: boolean
}

export interface CodeCommandOutputEvent {
  runId: string
  stream: 'stdout' | 'stderr' | 'exit'
  data: string
  exitCode?: number
}

/** A renderer `error` or `unhandledrejection`, forwarded to main.log. */
export interface RendererErrorReport {
  kind: 'error' | 'unhandledrejection' | 'boundary'
  message: string
  stack?: string
  /** The route the renderer was on. */
  location?: string
}
