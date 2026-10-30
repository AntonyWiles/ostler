import { type RestartToUpdateMode } from '@shared/ostler-api'
import type { UpdateService } from '../services/update-service'
import { handleApi } from './handle-ipc'

const RESTART_MODES: readonly RestartToUpdateMode[] = ['now', 'when-agents-finish']

/** Updates (P10.1): Settings › About, the update toast and the Inbox item. */
export function registerUpdateHandlers(updateService: UpdateService): void {
  handleApi('getUpdateState', () => updateService.state())
  handleApi('checkForUpdates', () => updateService.check())
  handleApi('downloadUpdate', () => updateService.download())
  handleApi('restartToUpdate', (_event, mode: unknown) => {
    if (!RESTART_MODES.includes(mode as RestartToUpdateMode)) {
      throw new Error('Restart now, or when agents finish')
    }
    return updateService.restart(mode as RestartToUpdateMode)
  })
}
