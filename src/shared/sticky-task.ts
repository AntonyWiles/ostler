/**
 * Sticky task on the desktop (N5.8b, N43): one task in a small window of its
 * own that stays on top of other windows. A sticky window opens the same page
 * as the main window on the sticky hash, `#/sticky/<projectId>/<taskId>`.
 * Shared by main (which checks every id it is handed) and the renderer.
 */

/** At most this many tasks are pinned at once; the next asks to unpin one. */
export const MAX_STICKY_TASKS = 5

const PREFIX = '/sticky/'
const ID = /^[A-Za-z0-9_-]{1,100}$/

/** Which task a sticky window shows. */
export interface StickyTaskRef {
  projectId: string
  taskId: string
}

/** Whether `projectId` and `taskId` are ids main accepts. */
export function isStickyTaskRef(projectId: unknown, taskId: unknown): boolean {
  return (
    typeof projectId === 'string' &&
    typeof taskId === 'string' &&
    ID.test(projectId) &&
    ID.test(taskId)
  )
}

/** The key a pinned task is kept by: one window per task. */
export function stickyTaskKey(ref: StickyTaskRef): string {
  return `${ref.projectId}/${ref.taskId}`
}

/** The hash a sticky window opens on. */
export function stickyTaskHash(ref: StickyTaskRef): string {
  return `${PREFIX}${ref.projectId}/${ref.taskId}`
}

/** The task inside a sticky hash (without the leading `#`), or null when it is not one. */
export function parseStickyTaskHash(hash: string): StickyTaskRef | null {
  if (!hash.startsWith(PREFIX)) return null
  const parts = hash.slice(PREFIX.length).split('?')[0].split('/')
  if (parts.length !== 2) return null
  const [projectId, taskId] = parts
  return isStickyTaskRef(projectId, taskId) ? { projectId, taskId } : null
}

/** One pinned task in `config.json` (config migration 38). Pinned means listed. */
export interface StickyTaskState extends StickyTaskRef {
  /** Its size and place when it last closed or moved, or null before then. */
  bounds: { x: number; y: number; width: number; height: number } | null
}

/** `config.stickyTasks` as config migration 38 writes it. */
export interface StickyTaskSettings {
  /** The pinned tasks, oldest first. Every one reopens at start. */
  windows: StickyTaskState[]
}

export const DEFAULT_STICKY_TASK_SETTINGS: StickyTaskSettings = { windows: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeBounds(value: unknown): StickyTaskState['bounds'] {
  if (!isRecord(value)) return null
  const { x, y, width, height } = value
  const numbers = [x, y, width, height]
  if (!numbers.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null
  if ((width as number) <= 0 || (height as number) <= 0) return null
  return {
    x: Math.round(x as number),
    y: Math.round(y as number),
    width: Math.round(width as number),
    height: Math.round(height as number)
  }
}

/** `config.stickyTasks` within its bounds: valid ids, one entry per task, at most five. */
export function normalizeStickyTaskSettings(value: unknown): StickyTaskSettings {
  const raw = isRecord(value) && Array.isArray(value.windows) ? value.windows : []
  const seen = new Set<string>()
  const windows: StickyTaskState[] = []
  for (const entry of raw) {
    if (!isRecord(entry) || !isStickyTaskRef(entry.projectId, entry.taskId)) continue
    const ref = { projectId: entry.projectId as string, taskId: entry.taskId as string }
    const key = stickyTaskKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    windows.push({ ...ref, bounds: normalizeBounds(entry.bounds) })
  }
  return { windows: windows.slice(0, MAX_STICKY_TASKS) }
}

/** What pinning a task did (`pinTaskToDesktop`). */
export type StickyPinResult =
  | { pinned: true }
  /** Five are pinned: the person is asked to unpin one, the oldest offered. */
  | { pinned: false; full: true; oldest: StickyTaskRef }
