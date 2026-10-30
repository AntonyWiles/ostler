import type { CreatePersonInput, Person, UpdatePersonInput } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { respondJson } from '../loopback-http'
import type { AutomationRouteDef, RouteCall } from './route-table'

/** The people service, or an error when main has not set one up. */
function peopleApi({ server }: RouteCall) {
  if (!server.people) throw new Error('People API unavailable')
  return server.people
}

/**
 * The person `:personId` names. Another project's own person is not this
 * token's to see: as if there were no such person.
 */
function ourPerson(call: RouteCall): string {
  const id = call.params.personId!
  const person: Person = peopleApi(call).service.get(id)
  if (person.projectId !== null && person.projectId !== call.project.id)
    throw new Refusal('Person not found')
  return id
}

/** Records the change and tells the app's windows, as a change made there would. */
function changed(call: RouteCall, value: unknown): void {
  const { server, req, res, project, path } = call
  server.recordMutation(project, path, `automation-api ${(req.method ?? '').toLowerCase()} people`)
  peopleApi(call).notify()
  respondJson(res, 200, { ok: true, value })
}

/**
 * People (P5.1): records you assign work to, in the address book (every
 * project) or one project's own (migration 78). Any project's token may
 * read and change the address book, since the token acts for the human,
 * who owns it; of the projects' own people it sees only its project's.
 */
export const PEOPLE_ROUTES: AutomationRouteDef[] = [
  {
    method: 'GET',
    path: '/people',
    description:
      "List the people work can be assigned to in this project: the address book (projectId null), shared by every project, and this project's own people (projectId this project's id), who are offered only here and go when the project is removed. Another project's own people are not listed, and cannot be given work here. isMe marks the person Ostler treats as you. Archived people (their tasks stay assigned) are left out unless ?includeArchived=true. weeklyCapacityHours is the hours a week the person plans to work (null when not set) and workingDays their working days as ISO weekdays (1 Monday to 7 Sunday); the Workload view compares planned work with them.",
    response:
      '{ ok: true, value: Array<{ id, name, initials, color, isMe, archivedAt, weeklyCapacityHours: number | null, workingDays: number[], projectId: string | null }> }',
    handler: (call) => {
      const includeArchived = call.query.get('includeArchived') === 'true'
      const value = peopleApi(call)
        .service.list({ includeArchived })
        .filter((person) => person.projectId === null || person.projectId === call.project.id)
      respondJson(call.res, 200, { ok: true, value })
    }
  },
  {
    method: 'POST',
    path: '/people',
    description:
      "Add a person, to the address book or (projectId: this project's id) to this project's own people. Initials follow the name and the colour comes from the project palette unless you set them.",
    request:
      'JSON body: { name: string, initials?: string (up to 3 letters), color?: "#rrggbb", weeklyCapacityHours?: number (0 to 168) | null, workingDays?: number[] (ISO weekdays 1 to 7, at least one; Monday to Friday when left out), projectId?: string | null (this project, or null for the address book) }.',
    response: '{ ok: true, value: Person }',
    exampleBody: { name: 'Alex Chen' },
    handler: (call) => {
      const { body, project } = call
      if (body.projectId !== undefined && body.projectId !== null && body.projectId !== project.id)
        throw new Refusal('projectId can only be this project, or null for the address book')
      changed(call, peopleApi(call).service.create(body as unknown as CreatePersonInput))
    }
  },
  {
    method: 'PATCH',
    path: '/people/:personId',
    description:
      'Rename or recolour a person, archive or unarchive them (archived: true or false), or make them you (isMe: true; whoever was you before no longer is), or set their weekly capacity and working days. initials: "" goes back to initials from the name; weeklyCapacityHours: null clears the capacity.',
    request:
      'JSON body: { name?, initials?, color?, weeklyCapacityHours?: number (0 to 168) | null, workingDays?: number[] (ISO weekdays 1 to 7, at least one), archived?: boolean, isMe?: true }.',
    response: '{ ok: true, value: Person }',
    exampleBody: { archived: true },
    handler: (call) => {
      const id = ourPerson(call)
      const { name, initials, color, weeklyCapacityHours, workingDays, archived, isMe } = call.body
      const edits = { name, initials, color, weeklyCapacityHours, workingDays }
      if ([...Object.values(edits), archived, isMe].every((field) => field === undefined))
        throw new Refusal(
          'Send at least one of: name, initials, color, weeklyCapacityHours, workingDays, archived, isMe'
        )
      if (archived !== undefined && typeof archived !== 'boolean')
        throw new Refusal('archived must be true or false')
      if (isMe !== undefined && isMe !== true)
        throw new Refusal('isMe can only be true: make someone else you to change it')
      const edited = Object.values(edits).some((field) => field !== undefined)
      changed(
        call,
        peopleApi(call).service.change(id, edited ? (edits as UpdatePersonInput) : null, {
          archived,
          isMe
        })
      )
    }
  },
  {
    method: 'GET',
    path: '/people/:personId/usage',
    description:
      "Where a person's work is, before deleting them: tasks by project (assigned to them, a checklist item theirs, or a turn in a repeat; live or archived, not in the recycle bin), the rules that name them, whether they are you, and whether they are a member of a shared project. Neither of the last two can be deleted.",
    response:
      '{ ok: true, value: { projects: Array<{ projectId, tasks: number }>, rules: number, isMe: boolean, sharedMember: boolean } }',
    handler: (call) => {
      const id = ourPerson(call)
      respondJson(call.res, 200, { ok: true, value: peopleApi(call).service.usage(id) })
    }
  },
  {
    method: 'DELETE',
    path: '/people/:personId',
    description:
      "Delete a person for good, in one transaction. Irreversible. giveTasksTo hands their tasks, checklist items, turns in repeats, and the rules and task templates that name them to another person, who must be able to take every one (the address book, or the same project's own people); null leaves their tasks unassigned, takes them out of repeats and turns off the rules that name them. Their days off go. Comments, activity and time they logged keep their id. You (isMe) and members of a shared project are refused.",
    request: 'JSON body: { giveTasksTo: string | null }.',
    response: '{ ok: true, value: null }',
    exampleBody: { giveTasksTo: null },
    handler: (call) => {
      const id = ourPerson(call)
      const people = peopleApi(call)
      const giveTasksTo = call.body.giveTasksTo ?? null
      if (giveTasksTo !== null && typeof giveTasksTo !== 'string')
        throw new Refusal(
          'giveTasksTo must be a person id, or null to leave their tasks unassigned'
        )
      const touched = people.service.usage(id).projects.map((entry) => entry.projectId)
      people.service.delete(id, { giveTasksTo })
      for (const projectId of touched) people.notifyPlanning?.(projectId)
      changed(call, null)
    }
  }
]
