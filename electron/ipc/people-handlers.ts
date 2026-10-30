import type { CreatePersonInput, DeletePersonOptions, UpdatePersonInput } from '@shared/ostler-api'
import type { PeopleService } from '../services/people-service'
import type { ApiArgs, ApiInvokeMethod, ApiValue } from '@shared/ostler-api/api-channels'
import { handleApi } from './handle-ipc'

export interface PeopleHandlerDependencies {
  peopleService: PeopleService
  /** Pushes ON_PROJECT_STATE_CHANGE with field 'people'. */
  notifyPeopleChanged(): void
  /** Pushes ON_PROJECT_STATE_CHANGE with field 'planning' for one project. */
  notifyPlanningChanged(projectId: string): void
}

/**
 * People (P5.1): the address book and each project's own. No project is
 * resolved here; the service validates every id and field, the same as for
 * the automation API.
 */
export function registerPeopleHandlers({
  peopleService,
  notifyPeopleChanged,
  notifyPlanningChanged
}: PeopleHandlerDependencies): void {
  const mutating = <M extends ApiInvokeMethod>(
    method: M,
    handler: (...args: ApiArgs<M>) => ApiValue<M>
  ) =>
    handleApi(method, async (_event, ...args) => {
      const person = handler(...args)
      notifyPeopleChanged()
      return person
    })

  handleApi('getPeople', async (_event, options?: { includeArchived?: boolean }) =>
    peopleService.list({ includeArchived: options?.includeArchived === true })
  )
  mutating('createPerson', (input: CreatePersonInput) => peopleService.create(input))
  mutating('updatePerson', (personId: string, updates: UpdatePersonInput) =>
    peopleService.update(personId, updates)
  )
  mutating('archivePerson', (personId: string) => peopleService.archive(personId))
  mutating('unarchivePerson', (personId: string) => peopleService.unarchive(personId))
  mutating('setMe', (personId: string) => peopleService.setMe(personId))
  handleApi('getPersonUsage', async (_event, personId: string) => peopleService.usage(personId))
  handleApi('deletePerson', async (_event, personId: string, options: DeletePersonOptions) => {
    // The projects whose tasks change, read before the person goes.
    const usage = peopleService.usage(personId)
    peopleService.delete(personId, options)
    notifyPeopleChanged()
    for (const { projectId } of usage.projects) notifyPlanningChanged(projectId)
  })
}
