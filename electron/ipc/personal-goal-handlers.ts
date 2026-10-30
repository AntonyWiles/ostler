import type {
  CreatePersonalGoalInput,
  DeletedPersonalGoal,
  GoalCheckInInput,
  PersonalGoalCheckIn,
  UpdatePersonalGoalInput,
  WatchedProject
} from '@shared/ostler-api'
import type { PlanningService } from '../services/planning-service'
import { handleApi } from './handle-ipc'

/**
 * Goals of one's own (N5.6b): the Goals view and a project goal's Counts
 * towards… write as Me through the one service the automation API uses.
 * A project goal's id is checked there; its project must be one Ostler knows
 * and has on to change its link.
 */
export function registerPersonalGoalHandlers({
  planningService,
  getProject,
  getProjectIds
}: {
  planningService: PlanningService
  getProject(projectId: string): WatchedProject
  /** The projects that are on: the Add a project goal picker offers their goals only. */
  getProjectIds(): string[]
}): void {
  const goals = planningService.personalGoals
  handleApi('listPersonalGoals', async () => goals.list())
  handleApi('createPersonalGoal', async (_event, input: CreatePersonalGoalInput) =>
    goals.create(input)
  )
  handleApi('updatePersonalGoal', async (_event, id: string, input: UpdatePersonalGoalInput) =>
    goals.update(id, input)
  )
  handleApi('deletePersonalGoal', async (_event, id: string) => goals.delete(id))
  handleApi('restorePersonalGoal', async (_event, deleted: DeletedPersonalGoal) =>
    goals.restore(deleted)
  )
  handleApi('recordPersonalGoalCheckIn', async (_event, id: string, input: GoalCheckInInput) =>
    goals.recordCheckIn(id, input, planningService.humanActor())
  )
  handleApi('deletePersonalGoalCheckIn', async (_event, id: string, date: string) =>
    goals.deleteCheckIn(id, date)
  )
  handleApi(
    'restorePersonalGoalCheckIn',
    async (_event, id: string, checkIn: PersonalGoalCheckIn) =>
      goals.restoreCheckIn(id, checkIn, planningService.humanActor())
  )
  handleApi(
    'setGoalCountsTowards',
    async (_event, goalId: string, personalGoalId: string | null) => {
      getProject(planningService.getGoal(String(goalId)).projectId)
      return goals.setCountsTowards(goalId, personalGoalId)
    }
  )
  handleApi('listGoalsCountsTowards', async (_event, projectId: string) =>
    goals.countsTowardsForProject(getProject(projectId).id)
  )
  handleApi('listLinkableProjectGoals', async () => {
    const on = new Set(getProjectIds())
    return goals.linkableProjectGoals().filter((goal) => on.has(goal.projectId))
  })
}
