import { isStickyTaskRef, type StickyPinResult, type StickyTaskRef } from '@shared/sticky-task'
import { handleApi } from './handle-ipc'

/** What the sticky task channels need: the sticky windows. */
export interface StickyTaskHandlerDependencies {
  pin(ref: StickyTaskRef, unpinOldest: boolean): StickyPinResult
  unpin(ref: StickyTaskRef): void
  /** The task of the sticky window whose renderer this is, or null for any other window. */
  taskOf(sender: unknown): StickyTaskRef | null
  /** Hands the focus back to the app before the sticky window, which stays open. */
  releaseFocus(sender: unknown): void
}

/**
 * Sticky task on the desktop (N5.8b): pin a task, unpin a sticky window, the
 * task a sticky window shows, and Esc's focus release. Every id is checked in
 * main before a window opens on it; a sticky window only unpins itself.
 */
export function registerStickyTaskHandlers(deps: StickyTaskHandlerDependencies): void {
  handleApi(
    'pinTaskToDesktop',
    (_event, projectId: unknown, taskId: unknown, unpinOldest: unknown) => {
      if (!isStickyTaskRef(projectId, taskId)) throw new Error('Pin one task')
      return deps.pin(
        { projectId: projectId as string, taskId: taskId as string },
        unpinOldest === true
      )
    }
  )
  handleApi('unpinStickyTask', (event) => {
    const ref = deps.taskOf(event.sender)
    if (!ref) throw new Error('Only a sticky window unpins itself')
    deps.unpin(ref)
  })
  handleApi('getStickyTask', (event) => deps.taskOf(event.sender))
  handleApi('releaseStickyFocus', (event) => {
    if (!deps.taskOf(event.sender)) throw new Error('Only a sticky window lets go of the focus')
    deps.releaseFocus(event.sender)
  })
}
