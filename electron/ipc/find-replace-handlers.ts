import type { WatchedProject } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { FIND_REPLACE_LIMITS } from '@shared/planning/find-replace'
import type { PlanningService } from '../services/planning-service'
import {
  FindReplaceService,
  findReplaceChanges,
  findReplaceChoices,
  findReplaceQuery
} from '../services/find-replace-service'
import { handleApi } from './handle-ipc'

export interface FindReplaceHandlerDependencies {
  planningService: PlanningService
  /** Resolves an enabled project or throws: the access check. */
  getProject(projectId: string): WatchedProject
}

/** Find and replace (N2.5): preview, apply and undo, for one project at a time. */
export function registerFindReplaceHandlers({
  planningService,
  getProject
}: FindReplaceHandlerDependencies): void {
  const service = new FindReplaceService(planningService)
  const projectId = (raw: unknown): string => {
    if (typeof raw !== 'string' || !raw) throw new Refusal('Choose a project')
    return getProject(raw).id
  }

  handleApi('previewFindReplace', async (_event, project: unknown, raw: unknown) =>
    service.preview(findReplaceQuery(projectId(project), raw))
  )
  handleApi(
    'applyFindReplace',
    async (_event, project: unknown, replace: unknown, matches: unknown) => {
      if (typeof replace !== 'string' || replace.length > FIND_REPLACE_LIMITS.description)
        throw new Refusal('replace must be text')
      return service.apply(
        projectId(project),
        replace,
        findReplaceChoices(matches),
        planningService.humanActor()
      )
    }
  )
  handleApi('revertFindReplace', async (_event, project: unknown, changes: unknown) =>
    service.applyChanges(
      projectId(project),
      findReplaceChanges(changes),
      planningService.humanActor()
    )
  )
}
