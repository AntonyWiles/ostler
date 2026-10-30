import type { CreateTeamInput, UpdateTeamInput } from '@shared/ostler-api'
import type { TeamService } from '../services/team-service'
import type { ApiArgs, ApiInvokeMethod, ApiValue } from '@shared/ostler-api/api-channels'
import { handleApi } from './handle-ipc'

export interface TeamHandlerDependencies {
  teamService: TeamService
  /** Pushes ON_PROJECT_STATE_CHANGE with field 'teams'. */
  notifyTeamsChanged(): void
}

/**
 * Teams (team-leaders plan, D1): the person's own groups of people. They grant nothing, so
 * nothing here checks a role; the service validates every id and field.
 */
export function registerTeamHandlers({ teamService, notifyTeamsChanged }: TeamHandlerDependencies) {
  const mutating = <M extends ApiInvokeMethod>(
    method: M,
    handler: (...args: ApiArgs<M>) => ApiValue<M> | Promise<ApiValue<M>>
  ) =>
    handleApi(method, async (_event, ...args) => {
      const result = handler(...args)
      notifyTeamsChanged()
      return result
    })

  handleApi('listTeams', async (_event, options?: { includeArchived?: boolean }) =>
    teamService.list({ includeArchived: options?.includeArchived === true })
  )
  mutating('createTeam', (input: CreateTeamInput) => teamService.create(input))
  mutating('updateTeam', (teamId: string, updates: UpdateTeamInput) =>
    teamService.update(teamId, updates)
  )
  mutating('setTeamMembers', (teamId: string, personIds: string[]) =>
    teamService.setMembers(teamId, personIds)
  )
  mutating('archiveTeam', (teamId: string) => teamService.archive(teamId))
  mutating('restoreTeam', (teamId: string) => teamService.restore(teamId))
  mutating('deleteTeam', (teamId: string) => teamService.delete(teamId))
}
