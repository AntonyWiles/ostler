import type { WatchedProject } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import type { FocusService } from '../services/focus-service'
import { handleApi } from './handle-ipc'

export interface FocusHandlerDependencies {
  focus: FocusService
  getProject(projectId: string): WatchedProject
}

/**
 * Focus (N3.5): every change goes through `FocusService`, whose change
 * listener tells the window and the tray, so these handlers do not notify.
 */
export function registerFocusHandlers(deps: FocusHandlerDependencies): void {
  const { focus, getProject } = deps
  handleApi('getFocus', () => focus.get())
  handleApi('startFocus', (_event, projectId: string, workItemId: string, minutes: unknown) =>
    focus.start(getProject(projectId).id, workItemId, minutes)
  )
  handleApi('stopFocus', () => focus.stop())
  handleApi('chooseFocusEnd', (_event, choice: unknown) => {
    if (choice !== 'break' && choice !== 'keep' && choice !== 'stop')
      throw new Refusal('Choose break, keep or stop')
    return focus.choose(choice)
  })
}
