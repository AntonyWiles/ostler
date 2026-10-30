import { Refusal } from '@shared/refusal'
import { respondJson } from '../loopback-http'
import type { AutomationRouteDef, RouteCall } from './route-table'

/** The shared contacts (N6.5): a change is recorded and announced as the app's are. */
function changeContact({ server, req, res, project, path }: RouteCall, value: unknown): void {
  server.recordMutation(
    project,
    path,
    `automation-api ${(req.method ?? '').toLowerCase()} contacts`
  )
  server.contactsChanged?.()
  respondJson(res, 200, { ok: true, value })
}

/** A task's contacts, for the token's project's tasks only. */
function changeTaskContacts({ server, req, res, project, path }: RouteCall, value: unknown): void {
  server.recordMutation(project, path, `${req.method} work item contacts`)
  server.onPlanningChange?.(project)
  respondJson(res, 200, { ok: true, value })
}

/** The planning service for a task of this project, or a refusal for another project's task. */
function taskPlanning({ server, project }: RouteCall, workItemId: string) {
  const planning = server.planning
  if (!planning) throw new Error('Planning API unavailable')
  if (planning.getWorkItem(workItemId).projectId !== project.id)
    throw new Refusal('Planning work item belongs to another project')
  return planning
}

/**
 * Contacts (N6.5): global, like people, so any project's token may manage
 * them through the same service the app uses; and the contacts each task names.
 */
export const CONTACTS_ROUTES: AutomationRouteDef[] = [
  {
    method: 'GET',
    path: '/contacts',
    description:
      'List contacts: the people a project involves who do no work in it, such as a plumber, a client or a supplier. Contacts are shared by every project, as people are, but they are not people: no task is assigned to them and they are not in Workload. ?q= keeps those whose name, organisation, role, emails or phone numbers hold every word. Sorted by name. Phone numbers are as typed; each phone has a label ("Mobile", "Work", or empty).',
    request: '?q=words (optional). No body.',
    response:
      '{ ok: true, value: Array<{ id, name, organisation, role, phones: Array<{ label, number }>, emails: string[], website, address, notes, createdAt, updatedAt }> }',
    handler: ({ server, res, query }) => {
      if (!server.planning) throw new Error('Planning API unavailable')
      respondJson(res, 200, {
        ok: true,
        value: server.planning.contacts.list(query.get('q') ?? '')
      })
    }
  },
  {
    method: 'POST',
    path: '/contacts',
    description:
      'Add a contact. name is required (up to 120 characters); organisation and role up to 120; up to 10 phones ({ label up to 40, number up to 40 }) and 10 emails (each one address); website (http or https; "example.com" counts as https), address (up to 500) and notes (up to 5,000).',
    request:
      'JSON body: { name: string, organisation?, role?, phones?: Array<{ label?, number }>, emails?: string[], website?, address?, notes? }.',
    response: '{ ok: true, value: Contact }',
    exampleBody: {
      name: 'Sam Rivera',
      organisation: 'Rivera Plumbing',
      phones: [{ label: 'Mobile', number: '+44 7700 900123' }]
    },
    handler: (call) => {
      if (!call.server.planning) throw new Error('Planning API unavailable')
      changeContact(call, call.server.planning.contacts.create(call.body))
    }
  },
  {
    method: 'PATCH',
    path: '/contacts/:contactId',
    description:
      'Change a contact. Fields left out keep their values; phones and emails, when sent, replace the whole list.',
    request:
      'JSON body: { name?, organisation?, role?, phones?: Array<{ label?, number }>, emails?: string[], website?, address?, notes? }.',
    response: '{ ok: true, value: Contact }',
    exampleBody: { role: 'Site manager' },
    handler: (call) => {
      if (!call.server.planning) throw new Error('Planning API unavailable')
      changeContact(call, call.server.planning.contacts.update(call.params.contactId!, call.body))
    }
  },
  {
    method: 'DELETE',
    path: '/contacts/:contactId',
    description:
      'Delete a contact for good, and every task\u2019s link to it, in every project. The tasks themselves are untouched. The response holds the contact and its links as they were.',
    request: 'No body.',
    response:
      '{ ok: true, value: { contact: Contact, links: Array<{ id, projectId, workItemId, contactId, role, createdAt }> } }',
    handler: (call) => {
      if (!call.server.planning) throw new Error('Planning API unavailable')
      changeContact(call, call.server.planning.contacts.delete(call.params.contactId!))
    }
  },
  {
    method: 'GET',
    path: '/work-items/:workItemId/contacts',
    description:
      'The contacts a task of this project names, in the order they were named, each with its role ("asked-for-it", "supplier" or "other") and the contact itself. Filter tasks by contact with GET /work-items?filter= and the "contact" field (ops hasAny, hasNone): value is a list of contact ids, each alone (any role) or as "<contact id>:<role>".',
    request: 'No body.',
    response:
      '{ ok: true, value: Array<{ id, projectId, workItemId, contactId, role, createdAt, contact: Contact }> }',
    handler: (call) => {
      const id = call.params.workItemId!
      respondJson(call.res, 200, { ok: true, value: taskPlanning(call, id).contacts.forTask(id) })
    }
  },
  {
    method: 'POST',
    path: '/work-items/:workItemId/contacts',
    description:
      'Name a contact on a task of this project with a role. A task names a contact once per role, and at most 20 contacts in all. Agents\u2019 task text never includes a task\u2019s contacts unless the person writes them into the description.',
    request: 'JSON body: { contactId: string, role: "asked-for-it" | "supplier" | "other" }.',
    response: '{ ok: true, value: TaskContact }',
    exampleBody: { contactId: '<contact id>', role: 'supplier' },
    handler: (call) => {
      const id = call.params.workItemId!
      const value = taskPlanning(call, id).contacts.link(id, call.body.contactId, call.body.role)
      changeTaskContacts(call, value)
    }
  },
  {
    method: 'DELETE',
    path: '/work-items/:workItemId/contacts/:linkId',
    description:
      'Take a contact off a task, by the link\u2019s id (from GET /work-items/:workItemId/contacts). The contact itself stays.',
    request: 'No body.',
    response: '{ ok: true, value: { id, projectId, workItemId, contactId, role, createdAt } }',
    handler: (call) => {
      const id = call.params.workItemId!
      changeTaskContacts(call, taskPlanning(call, id).contacts.unlink(id, call.params.linkId!))
    }
  }
]
