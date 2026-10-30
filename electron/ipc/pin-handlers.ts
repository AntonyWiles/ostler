import type {
  CreatePinInput,
  ListPinsQuery,
  MovePinInput,
  Pin,
  SetPinCountdownInput
} from '@shared/ostler-api'
import type { PlanningService } from '../services/planning-service'
import { handleApi } from './handle-ipc'

/**
 * Pins (N5.2a): the sidebar's Pinned section and each Overview's shortcuts.
 * The pin service checks every id it is given: the place, the kind, that the
 * target exists in a project Ostler knows, and the sidebar's limit.
 */
export function registerPinHandlers({
  planningService
}: {
  planningService: PlanningService
}): void {
  const pins = planningService.pins
  handleApi('listPins', async (_event, query: ListPinsQuery) => pins.list(query))
  handleApi('createPin', async (_event, input: CreatePinInput) => pins.create(input))
  handleApi('deletePin', async (_event, pinId: string) => pins.delete(pinId))
  handleApi('restorePin', async (_event, pin: Pin) => pins.restore(pin))
  handleApi('movePin', async (_event, pinId: string, input: MovePinInput) =>
    pins.move(pinId, input)
  )
  // Countdowns (N5.2b): the pin service checks the kind, the date and the limit of three.
  handleApi('setPinCountdown', async (_event, pinId: string, input: SetPinCountdownInput) =>
    pins.setCountdown(pinId, input)
  )
  handleApi('listCountdowns', async () => pins.countdowns())
}
