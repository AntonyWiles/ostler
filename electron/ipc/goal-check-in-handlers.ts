import type { GoalCheckIn, GoalCheckInInput, WatchedProject } from '@shared/ostler-api'
import type { PlanningService } from '../services/planning-service'
import { handleApi } from './handle-ipc'

/**
 * Goals' check-ins (N5.6a): the desktop app records, removes and puts back
 * as Me through the one service the automation API uses. Each goal id is
 * checked there; its project must be one Ostler knows and has on.
 */
export function registerGoalCheckInHandlers({
  planningService,
  getProject,
  getProjectIds
}: {
  planningService: PlanningService
  getProject(projectId: string): WatchedProject
  /** The projects Home shows: every one that is on. */
  getProjectIds(): string[]
}): void {
  const checkIns = planningService.goalCheckIns
  const own = (goalId: unknown) => {
    const goal = planningService.getGoal(String(goalId))
    getProject(goal.projectId)
    return goal.id
  }
  handleApi('listGoalCheckIns', async (_event, projectId: string) =>
    checkIns.listForProject(getProject(projectId).id)
  )
  handleApi('goalGlances', async () => planningService.goalGlances(getProjectIds()))
  handleApi('recordGoalCheckIn', async (_event, goalId: string, input: GoalCheckInInput) =>
    checkIns.record(own(goalId), input, planningService.humanActor())
  )
  handleApi('deleteGoalCheckIn', async (_event, goalId: string, date: string) =>
    checkIns.delete(own(goalId), date)
  )
  handleApi('restoreGoalCheckIn', async (_event, goalId: string, checkIn: GoalCheckIn) =>
    checkIns.restore(own(goalId), checkIn, planningService.humanActor())
  )
}
