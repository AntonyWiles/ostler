/**
 * The project folder's history as the History view shows it (simplify pass
 * §3.5). Built by `project-history.ts` from Git, in words for people who do
 * not know Git.
 */

/** What an entry is: an agent task, the person's own saved edits, an undo, a restore, or anything else. */
export type ProjectHistoryEntryKind = 'task' | 'your-edits' | 'undo' | 'restore' | 'other'

export interface ProjectHistoryEntry {
  id: string
  title: string
  /** When the entry was made, in milliseconds. */
  at: number
  kind: ProjectHistoryEntryKind
  /** The agent task this entry applied, for a task entry. */
  taskId: string | null
  /** The entries an undo entry undid. */
  undoes: string[]
  /** The files the entry changed, relative to the project folder. */
  files: string[]
  /** The folder's first entry, which cannot be undone. */
  first: boolean
  /** An undo still in force took this entry out: Undo the undo puts it back. */
  undone: boolean
}

export interface ProjectHistoryFilter {
  search?: string
  kind?: ProjectHistoryEntryKind
  limit?: number
}

export interface ProjectUndoResult {
  undone: boolean
  /** The new undo entry, when the undo was made. */
  entry: ProjectHistoryEntry | null
  /** When it was not: later entries that changed the same lines. */
  laterEntries: ProjectHistoryEntry[]
  /** The files that clashed. */
  conflicts: string[]
}

/** Work Ostler kept when a task was discarded or stopped, for "Bring back" (§3.3). */
export interface DiscardedTaskWork {
  sessionId: string
  taskId: string | null
  title: string
  discardedAt: string
}

export interface ProjectHistory {
  /** False when the folder has no version history yet. */
  available: boolean
  /** The line of work the folder is on, or null. */
  version: string | null
  entries: ProjectHistoryEntry[]
  discarded: DiscardedTaskWork[]
}

/** Space Ostler uses for agent copies and kept history (Settings › Data). */
export interface AgentStorageUsage {
  copiesBytes: number
  copies: number
  restorePoints: number
  discardedWork: number
  /** Files from the agent setup before the simplify pass, kept until the person removes them. */
  legacyBytes: number
}
