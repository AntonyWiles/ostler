import type { AIHaltState } from '@shared/ostler-api'
import { setAiHalted } from './ai-halt'
import { abortAllAiRequests } from './ai-provider'

export interface EmergencyStopDependencies {
  /** Ends every running embedded session with this note; returns how many. */
  stopRunners(reason: string): Promise<number>
  /** After the stop: the Agents views and the status bar read the new state. */
  afterStop(): void
}

/**
 * The emergency stop (`EMERGENCY_STOP_AI`): one function for the status bar's
 * button and the tray's Stop all AI (P8.2). It halts first, so nothing
 * restarts while the rest is torn down, then cancels every in-flight model
 * request and ends every running embedded session.
 */
export async function emergencyStopAi(deps: EmergencyStopDependencies): Promise<AIHaltState> {
  setAiHalted(true)
  abortAllAiRequests()
  const stoppedSessions = await deps.stopRunners('Stopped: the emergency stop was pressed.')
  deps.afterStop()
  return { halted: true, stoppedSessions }
}
