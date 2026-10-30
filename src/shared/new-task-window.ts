import type { PlanningFieldValuesInput } from './ostler-api'

/**
 * New task in a window of its own: the half-written task moves out of the main window into a
 * small window, and back again. The window opens the same page as the main window on
 * `#/new-task/<projectId>`. The draft is handed over by main, in memory only, never kept.
 * Shared by main (which checks every id and the draft size) and the renderer.
 */

const PREFIX = '/new-task/'
const ID = /^[A-Za-z0-9_-]{1,100}$/

/** The most a draft may weigh when handed over, in characters of JSON. */
export const NEW_TASK_DRAFT_MAX_CHARS = 400_000

/** Whether `projectId` is an id main accepts. */
export function isNewTaskProjectId(projectId: unknown): projectId is string {
  return typeof projectId === 'string' && ID.test(projectId)
}

/** The hash a New task window opens on. */
export function newTaskWindowHash(projectId: string): string {
  return `${PREFIX}${projectId}`
}

/** The project inside a New task hash (without the leading `#`), or null when it is not one. */
export function parseNewTaskHash(hash: string): { projectId: string } | null {
  if (!hash.startsWith(PREFIX)) return null
  const projectId = hash.slice(PREFIX.length).split('?')[0]
  return isNewTaskProjectId(projectId) ? { projectId } : null
}

/** Everything New task's form holds, as handed between windows. */
/** A picture pasted into New task, kept in the project's Library until Create attaches it. */
export interface NewTaskPicture {
  id: string
  title: string
}

export interface NewTaskDraft {
  title: string
  description: string
  status: string
  /** The project's own column (MOP-26) it starts in; left out or null for the status's own. */
  columnId?: string | null
  priority: string
  milestoneId: string
  iterationId: string
  typeId: string
  labels: string
  criteria: string
  autoQueue: boolean
  assigneeId: string | null
  startDate: string
  targetDate: string
  estimate: number | null
  dependencyIds: string[]
  fieldValues: PlanningFieldValuesInput
  templateId: string
  /** Pasted pictures (MOP-31); absent in a draft from before they were kept apart. */
  pictures?: NewTaskPicture[]
}

/**
 * What opening New task in its own window did: `opened` false when the project's window was
 * already open and came forward instead, so the draft stays in the window that asked.
 */
export interface NewTaskWindowResult {
  opened: boolean
}

/** Whether a value handed over by a window is a draft main may pass on: a plain object of bounded size. */
export function isPassableDraft(value: unknown): value is NewTaskDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    return JSON.stringify(value).length <= NEW_TASK_DRAFT_MAX_CHARS
  } catch {
    return false
  }
}
