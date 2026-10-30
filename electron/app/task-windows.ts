import { isTaskWindowRef } from '@shared/task-window'

/**
 * A task in a window of its own (MOP-12): at most one window per task. The task saves as it is
 * edited, so a window holds nothing of its own: closing it loses nothing.
 */

/** What this needs of a window: Electron's `BrowserWindow`, or a test's fake. */
export interface TaskWindowLike {
  on(event: 'closed', listener: () => void): unknown
  isDestroyed(): boolean
}

export interface TaskWindowsDependencies<W extends TaskWindowLike> {
  /** Opens a window on one task (through `createTaskWindow`). */
  create(projectId: string, taskId: string): W
  /** Brings an open window forward. */
  focus(win: W): void
  /** Whether a project is registered. */
  projectExists(projectId: string): boolean
}

export class TaskWindows<W extends TaskWindowLike> {
  private readonly windows = new Map<string, W>()

  constructor(private readonly deps: TaskWindowsDependencies<W>) {}

  /** Opens the task in its own window: true, or false when its window was open and came forward. */
  open(projectId: unknown, taskId: unknown): boolean {
    if (!isTaskWindowRef(projectId, taskId)) throw new Error('Open one task in its own window')
    const project = projectId as string
    const task = taskId as string
    if (!this.deps.projectExists(project)) throw new Error('That project is not in Ostler any more')
    const key = `${project}/${task}`
    const already = this.windows.get(key)
    if (already && !already.isDestroyed()) {
      this.deps.focus(already)
      return false
    }
    const win = this.deps.create(project, task)
    this.windows.set(key, win)
    win.on('closed', () => this.windows.delete(key))
    return true
  }
}
