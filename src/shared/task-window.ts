/**
 * A task in a window of its own (MOP-12): Pop out in a task's drawer opens the task's drawer,
 * alone, in a window beside the main one. A task saves as it is edited, so nothing is handed
 * over: the window opens the same page as the main window on `#/task-window/<projectId>/<taskId>`
 * and reads the task itself. Shared by main (which checks every id) and the renderer.
 */

const PREFIX = '/task-window/'
const ID = /^[A-Za-z0-9_-]{1,100}$/

/** One task, by its project and its id. */
export interface TaskWindowRef {
  projectId: string
  taskId: string
}

/** Whether `projectId` and `taskId` are ids main accepts. */
export function isTaskWindowRef(projectId: unknown, taskId: unknown): boolean {
  return (
    typeof projectId === 'string' &&
    ID.test(projectId) &&
    typeof taskId === 'string' &&
    ID.test(taskId)
  )
}

/** The hash a task window opens on. */
export function taskWindowHash(ref: TaskWindowRef): string {
  return `${PREFIX}${ref.projectId}/${ref.taskId}`
}

/** The task inside a task window hash (without the leading `#`), or null when it is not one. */
export function parseTaskWindowHash(hash: string): TaskWindowRef | null {
  if (!hash.startsWith(PREFIX)) return null
  const [projectId, taskId, ...rest] = hash.slice(PREFIX.length).split('?')[0].split('/')
  if (rest.length > 0 || !isTaskWindowRef(projectId, taskId)) return null
  return { projectId, taskId }
}

/**
 * What opening a task in its own window did: `opened` false when that task's window was already
 * open and came forward instead.
 */
export interface TaskWindowResult {
  opened: boolean
}
