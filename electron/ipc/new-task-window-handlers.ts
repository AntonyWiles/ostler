import type { NewTaskDraft } from '@shared/new-task-window'
import { handleApi } from './handle-ipc'

/** What the New task window channels need: the windows. */
export interface NewTaskWindowHandlerDependencies {
  open(projectId: unknown, draft: unknown): boolean
  takeOutgoing(sender: unknown): NewTaskDraft | null
  giveBack(sender: unknown, draft: unknown): void
  takeReturned(projectId: unknown): NewTaskDraft | null
}

/**
 * A task in a window of its own (MOP-12): opens it, or brings its open window forward. Ids are
 * checked in main.
 */
export function registerTaskWindowHandlers(deps: {
  open(projectId: unknown, taskId: unknown): boolean
}): void {
  handleApi('openTaskWindow', (_event, projectId: unknown, taskId: unknown) => ({
    opened: deps.open(projectId, taskId)
  }))
}

/**
 * New task in its own window: move a draft out to a window, take it there, hand it back to the
 * main window, and take it back. Ids and the draft size are checked in main.
 */
export function registerNewTaskWindowHandlers(deps: NewTaskWindowHandlerDependencies): void {
  handleApi('openNewTaskWindow', (_event, projectId: unknown, draft: unknown) => {
    // Not opened: a window for the project was already open and came forward instead.
    return { opened: deps.open(projectId, draft) }
  })
  handleApi('takeNewTaskDraft', (event) => deps.takeOutgoing(event.sender))
  handleApi('returnNewTaskToMain', (event, draft: unknown) => {
    deps.giveBack(event.sender, draft)
  })
  handleApi('takeReturnedNewTask', (_event, projectId: unknown) => deps.takeReturned(projectId))
}
