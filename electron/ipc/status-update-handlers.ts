import type { StatusUpdate, StatusUpdateDraft, WatchedProject } from '@shared/ostler-api'
import type { AIPlanningService } from '../services/ai-planning-service'
import type { PlanningService } from '../services/planning-service'
import { statusDraftInput } from '../services/status-update-draft'
import { handleApi } from './handle-ipc'

/**
 * Status updates (N5.5): the desktop app posts, edits and deletes as Me
 * through the one service the automation API uses. Every id is checked
 * there; the project must be one Ostler knows and has on.
 */
export function registerStatusUpdateHandlers({
  planningService,
  aiPlanningService,
  getProject,
  getProjectIds
}: {
  planningService: PlanningService
  aiPlanningService: AIPlanningService
  getProject(projectId: string): WatchedProject
  /** The projects Home shows: every one that is on. */
  getProjectIds(): string[]
}): void {
  const updates = planningService.statusUpdates
  const own = (updateId: unknown) => {
    const update = updates.get(updateId)
    getProject(update.projectId)
    return update
  }
  handleApi('listStatusUpdates', async (_event, projectId: string) =>
    updates.list(getProject(projectId).id)
  )
  handleApi('latestStatusUpdates', async () => updates.latestFor(getProjectIds()))
  handleApi('postStatusUpdate', async (_event, projectId: string, input: unknown) =>
    updates.post(getProject(projectId).id, input, planningService.humanActor())
  )
  handleApi('editStatusUpdate', async (_event, updateId: string, input: unknown) => {
    own(updateId)
    return updates.edit(updateId, input)
  })
  handleApi('deleteStatusUpdate', async (_event, updateId: string) => {
    own(updateId)
    return updates.delete(updateId)
  })
  handleApi('restoreStatusUpdate', async (_event, updateId: string) => {
    const restored = updates.restore(updateId)
    getProject(restored.projectId)
    return restored
  })
  handleApi('revertStatusUpdate', async (_event, updateId: string, before: StatusUpdate) => {
    own(updateId)
    return updates.revert(updateId, before)
  })
  handleApi('draftStatusUpdate', async (_event, projectId: string): Promise<StatusUpdateDraft> => {
    const project = getProject(projectId)
    return await aiPlanningService.draftStatusUpdate(project.id, () =>
      statusDraftInput(planningService, project)
    )
  })
}
