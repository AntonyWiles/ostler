import type {
  CreatePlanningFieldInput,
  CreatePlanningRuleInput,
  CreatePlanningSubprojectInput,
  CreatePlanningTaskTypeInput,
  PlanningFieldDeletion,
  PlanningLabelDeletion,
  PlanningRuleDeletion,
  PlanningTaskTypeDeletion,
  UpdatePlanningColumnSettingsInput,
  UpdatePlanningFieldInput,
  UpdatePlanningRuleInput,
  UpdatePlanningSubprojectInput,
  UpdatePlanningTaskTypeInput
} from '@shared/ostler-api'
import { agentColumnsLocked } from '@shared/board-columns'
import { Refusal } from '@shared/refusal'
import { projectFolder } from '@shared/project-folder'
import { respondJson } from '../loopback-http'
import { AUTOMATION_ACTOR, planningChanged, planningOf } from './common'
import type { AutomationRouteDef, RouteCall } from './route-table'

/** A change to the project's setup, recorded as the old planning routes did. */
function setupChanged(call: RouteCall, resource: string, value: unknown): void {
  planningChanged(call, `${call.req.method} planning ${resource}`, value)
}

/** The rules service, after checking `:ruleId` is a rule of this project. */
function ourRules(call: RouteCall) {
  const rules = planningOf(call.server).rules
  rules.requireInProject(call.params.ruleId!, call.project.id)
  return rules
}

/** The task types service, after checking `:typeId` is a type of this project. */
function ourTypes(call: RouteCall) {
  const types = planningOf(call.server).taskTypes
  types.requireInProject(call.params.typeId!, call.project.id)
  return types
}

/** The workstreams service, after checking `:subprojectId` is one of this project's. */
function ourSubprojects(call: RouteCall) {
  const subprojects = planningOf(call.server).subprojects
  subprojects.requireInProject(call.params.subprojectId!, call.project.id)
  return subprojects
}

/**
 * A project's setup, through the same rules as the app: rules (R6.2), task
 * types (N2.7a), workstreams, custom fields, labels and Board columns.
 */
export const SETUP_ROUTES: AutomationRouteDef[] = [
  {
    method: 'GET',
    path: '/subprojects',
    description:
      "List the project's workstreams (sub-projects: named parts of one project), archived ones included, in the project's order. Each has a name, description, color, icon, leadId (a person id or null), memberIds, status, archivedAt (null unless archived) and position. Tasks and milestones say which one they are in with subprojectId (null for the top level of the project).",
    response: '{ ok: true, value: PlanningSubproject[] }',
    handler: ({ server, res, project }) =>
      respondJson(res, 200, { ok: true, value: planningOf(server).subprojects.list(project.id) })
  },
  {
    method: 'POST',
    path: '/subprojects',
    description:
      'Create a workstream at the end of the project’s order. The name is required (up to 80 characters).',
    request:
      'JSON body: { name: string, description?: string, color?: "#rrggbb" (default the project\'s colour), icon?: string, leadId?: string | null (a person id from GET /people), memberIds?: string[] (person ids), status?: "planned" | "active" | "paused" | "done" }',
    response: '{ ok: true, value: PlanningSubproject }',
    exampleBody: { name: 'Hull', description: 'Everything about the hull', status: 'active' },
    handler: (call) =>
      setupChanged(
        call,
        'subprojects',
        planningOf(call.server).subprojects.create(call.project.id, {
          ...(call.body as unknown as CreatePlanningSubprojectInput),
          color: (call.body.color as string | undefined) ?? call.project.color
        })
      )
  },
  {
    method: 'PATCH',
    path: '/subprojects/:subprojectId',
    description:
      'Change a workstream: any of its fields, and archived to archive it (true) or bring it back (false). An archived workstream keeps its tasks and milestones.',
    request:
      'JSON body with any of { name, description, color, icon, leadId, memberIds, status, archived: boolean }.',
    response: '{ ok: true, value: PlanningSubproject }',
    exampleBody: { archived: true },
    handler: (call) => {
      const subprojects = ourSubprojects(call)
      const id = call.params.subprojectId!
      const { archived, ...fields } = call.body
      if (archived !== undefined && typeof archived !== 'boolean')
        throw new Refusal('archived must be true or false')
      let value = Object.keys(fields).length
        ? subprojects.update(id, fields as UpdatePlanningSubprojectInput)
        : subprojects.get(id)
      if (archived !== undefined) value = subprojects.archive(id, archived)
      setupChanged(call, 'subprojects', value)
    }
  },
  {
    method: 'POST',
    path: '/subprojects/:subprojectId/move',
    description:
      "Move a workstream one place earlier (-1) or later (1) in the project's order. At either end it stays put.",
    request: 'JSON body: { direction: -1 | 1 }',
    response:
      '{ ok: true, value: PlanningSubproject[] } (the project’s workstreams, in the new order)',
    exampleBody: { direction: 1 },
    handler: (call) =>
      setupChanged(
        call,
        'subprojects',
        ourSubprojects(call).move(call.params.subprojectId!, call.body.direction as -1 | 1)
      )
  },
  {
    method: 'DELETE',
    path: '/subprojects/:subprojectId',
    description:
      'Delete a workstream. Its tasks and milestones are kept and move to the top level of the project (subprojectId null).',
    response: '{ ok: true, value: PlanningSubproject } (the one that was deleted)',
    handler: (call) =>
      setupChanged(call, 'subprojects', ourSubprojects(call).delete(call.params.subprojectId!))
  },
  {
    method: 'GET',
    path: '/task-types',
    description:
      "List the project's task types, in its order: the kinds of task it has, such as Bug, Feature and Chore, or Errand and Repair. Each has a name (unique in the project, ignoring case), an icon (a lucide icon name from the curated set the app offers: circle-dot, bug, sparkles, wrench, hammer, clipboard-list, list-checks, lightbulb, rocket, flag, star, heart, zap, flame, shield, lock, search, gauge, test-tube, code, terminal, server, file-text, book-open, pen-tool, paintbrush, palette, phone, mail, message-square, calendar, shopping-cart, wallet, house, car, truck, plane, package, leaf, graduation-cap), a colour (#rrggbb), a position, fieldIds (the custom fields its tasks show, by id from GET /fields in the project's field order, or null for every field; hidden fields keep their values, and deleting a field takes it off every type) and templateId (a task template from GET /task-templates, of this project or every project, that new tasks of this type start from in the app's New task and quick add, or null; deleting the template clears it). A task has at most one type, in typeId (null for none); a type is not a label. Filter tasks by it with ?filter= on GET /work-items (field type: type ids or \"none\"). Agents see a task's type name in their task text.",
    response: '{ ok: true, value: PlanningTaskType[] }',
    handler: ({ server, res, project }) =>
      respondJson(res, 200, { ok: true, value: planningOf(server).taskTypes.list(project.id) })
  },
  {
    method: 'POST',
    path: '/task-types',
    description:
      'Create a task type at the end of the project’s order. Refused when the project has 20 already, or one with the same name (ignoring case), or the icon is not one of the curated set.',
    request:
      'JSON body: { name: string (up to 40 characters), icon?: string (default circle-dot), color?: "#rrggbb" (default a palette colour), fieldIds?: string[] | null (default null, every field; an id that is not one of the project\'s fields is refused), templateId?: string | null (a task template this project can use) }',
    response: '{ ok: true, value: PlanningTaskType }',
    exampleBody: { name: 'Bug', icon: 'bug', color: '#ef4444' },
    handler: (call) =>
      setupChanged(
        call,
        'task-types',
        planningOf(call.server).taskTypes.create(
          call.project.id,
          call.body as unknown as CreatePlanningTaskTypeInput
        )
      )
  },
  {
    method: 'POST',
    path: '/task-types/reorder',
    description:
      "Put the project's task types in this order. typeIds must name every one of them, once each.",
    request: 'JSON body: { typeIds: string[] }',
    response: '{ ok: true, value: PlanningTaskType[] }',
    handler: (call) => {
      if (!Array.isArray(call.body.typeIds)) throw new Refusal('typeIds must be a list of type ids')
      setupChanged(
        call,
        'task-types',
        planningOf(call.server).taskTypes.reorder(call.project.id, call.body.typeIds as string[])
      )
    }
  },
  {
    method: 'PATCH',
    path: '/task-types/:typeId',
    description:
      "Rename a task type, change its icon or colour, choose the custom fields its tasks show (fieldIds, null for every field) or the task template new tasks of this type start from (templateId, null for none). Its tasks keep it. Changing a task's type later never applies a template, and hiding a field never deletes its values.",
    request: 'JSON body with any of { name, icon, color, fieldIds, templateId }.',
    response: '{ ok: true, value: PlanningTaskType }',
    exampleBody: { name: 'Defect' },
    handler: (call) =>
      setupChanged(
        call,
        'task-types',
        ourTypes(call).update(call.params.typeId!, call.body as UpdatePlanningTaskTypeInput)
      )
  },
  {
    method: 'DELETE',
    path: '/task-types/:typeId',
    description:
      "Delete a task type. Its tasks keep everything but the type. The answer holds what was deleted and the tasks that had it, as the app's Undo uses: POST it to /task-types/restore to put both back.",
    response: '{ ok: true, value: { taskType: PlanningTaskType, taskIds: string[] } }',
    handler: (call) => setupChanged(call, 'task-types', ourTypes(call).delete(call.params.typeId!))
  },
  {
    method: 'POST',
    path: '/task-types/restore',
    description:
      'Undo a DELETE /task-types/:typeId: the type comes back as it was, and the tasks that had it get it back where they have no type now.',
    request: 'JSON body: the value DELETE /task-types/:typeId returned, { taskType, taskIds }.',
    response: '{ ok: true, value: PlanningTaskType }',
    handler: (call) => {
      const deletion = call.body as unknown as PlanningTaskTypeDeletion
      if (deletion?.taskType?.projectId !== call.project.id)
        throw new Refusal('That task type belongs to another project.')
      setupChanged(call, 'task-types', planningOf(call.server).taskTypes.restore(deletion))
    }
  },
  {
    method: 'GET',
    path: '/rules',
    description:
      'List the project’s rules, oldest first, the order they run in: "when this happens, if these hold, then do that". Each has a name, enabled (its on and off switch), one trigger, conditions (every one must hold) and actions, with lastRunAt and runCount. Triggers: { kind: "taskCreated" }, { kind: "statusChanged", to: status, from?: status }, { kind: "assigneeChanged" }, { kind: "subtasksDone" } (acts on the parent once its last subtask is done), { kind: "checklistComplete" }, { kind: "dueDateReached" } (checked hourly while Ostler runs, once per task per due date, for due dates on or after the day the rule was made). Conditions, each with op "is" or "isNot": { kind: "label", label }, { kind: "priority", priority }, { kind: "assignee", personId | null }, { kind: "milestone", milestoneId | null }, { kind: "status", status }, { kind: "field", fieldId, value } (a custom field: an option id, text, a number or true/false). Actions: setStatus, setPriority, setAssignee (personId or null), setMilestone (milestoneId or null), addLabel, removeLabel (label), addChecklistItems (items: up to 10), addComment (text), notifyMe (message, may be empty: an Inbox item and a desktop notification on this PC) and archive (only a Done task). There are no others: a rule never queues work for agents, starts or stops runs, deletes, touches the Library, calls Ostler AI or sends anything off the PC. A task with agent work keeps the status its run gives it. Rules run on every change from the app and from this API (POST and PATCH /work-items, /move, /checklist), in the same transaction; a change a rule makes sets off no rules; imports, project files and templates set off none. A rule that fails refuses the whole change with a message naming it.',
    response: '{ ok: true, value: PlanningRule[] }',
    handler: ({ server, res, project }) =>
      respondJson(res, 200, { ok: true, value: planningOf(server).rules.list(project.id) })
  },
  {
    method: 'POST',
    path: '/rules',
    description: 'Create a rule. A project has at most 50.',
    request:
      'JSON body: { name: string (up to 80 characters), enabled?: boolean (default true), trigger, conditions?: Condition[] (up to 10), actions: Action[] (1 to 10) }, shaped as GET /rules says.',
    response: '{ ok: true, value: PlanningRule }',
    exampleBody: {
      name: 'Escalate urgent bugs',
      trigger: { kind: 'statusChanged', to: 'blocked' },
      conditions: [{ kind: 'label', op: 'is', label: 'urgent' }],
      actions: [
        { kind: 'setPriority', priority: 'critical' },
        { kind: 'notifyMe', message: 'An urgent task is blocked' }
      ]
    },
    handler: (call) =>
      setupChanged(
        call,
        'rules',
        planningOf(call.server).rules.create(
          call.project.id,
          call.body as unknown as CreatePlanningRuleInput
        )
      )
  },
  {
    method: 'PATCH',
    path: '/rules/:ruleId',
    description:
      'Change a rule: rename it, switch it on or off (enabled), or replace its trigger, conditions or actions.',
    request: 'JSON body with any of { name, enabled, trigger, conditions, actions }.',
    response: '{ ok: true, value: PlanningRule }',
    exampleBody: { enabled: false },
    handler: (call) =>
      setupChanged(
        call,
        'rules',
        ourRules(call).update(call.params.ruleId!, call.body as UpdatePlanningRuleInput)
      )
  },
  {
    method: 'DELETE',
    path: '/rules/:ruleId',
    description:
      'Delete a rule. What it already did stays. The answer is what POST /rules/restore takes to put it back, as the app’s Undo does.',
    response: '{ ok: true, value: { rule: PlanningRule } }',
    handler: (call) => setupChanged(call, 'rules', ourRules(call).delete(call.params.ruleId!))
  },
  {
    method: 'POST',
    path: '/rules/restore',
    description: 'Put back a rule DELETE /rules/:ruleId removed.',
    request: 'JSON body: the value DELETE /rules/:ruleId returned, { rule: PlanningRule }.',
    response: '{ ok: true, value: PlanningRule }',
    handler: (call) => {
      const deletion = call.body as unknown as PlanningRuleDeletion
      if (deletion?.rule?.projectId !== call.project.id) throw new Refusal('Rule not found')
      setupChanged(call, 'rules', planningOf(call.server).rules.restore(deletion))
    }
  },
  {
    method: 'POST',
    path: '/rules/preview',
    description:
      'Try a rule on a task without changing anything, as the app’s "Try it on a task…" does: whether each condition holds for the task now, whether all do, and what each action would do (outcome "change", "none" when the task is already that way, "agentWork" when its agent run keeps the status, "notDone" when archive meets a task that is not Done). The trigger is not checked.',
    request: 'JSON body: { workItemId: string, conditions?: Condition[], actions: Action[] }',
    response:
      '{ ok: true, value: { conditions: boolean[], matches: boolean, effects: { action, outcome }[] } }',
    exampleBody: {
      workItemId: '<work item id>',
      conditions: [{ kind: 'label', op: 'is', label: 'urgent' }],
      actions: [{ kind: 'setPriority', priority: 'critical' }]
    },
    handler: (call) => {
      const { body } = call
      if (typeof body.workItemId !== 'string') throw new Refusal('workItemId is required')
      setupChanged(
        call,
        'rules',
        planningOf(call.server).rules.preview(
          call.project.id,
          body as unknown as Pick<CreatePlanningRuleInput, 'conditions' | 'actions'>,
          body.workItemId
        )
      )
    }
  },
  {
    method: 'GET',
    path: '/labels',
    description:
      'List every label used on the live and archived work items in this project, with its colour (a chosen one, or a stable default when hasColor is false) and how many tasks carry it.',
    response: '{ ok: true, value: Array<{ name, color, hasColor, taskCount }> }',
    handler: ({ server, res, project }) =>
      respondJson(res, 200, { ok: true, value: planningOf(server).listProjectLabels(project.id) })
  },
  {
    method: 'PATCH',
    path: '/labels/:name',
    description:
      'Rename a label on every task in the project at once (name), set its colour (color, #rrggbb), or both. URL-encode the name.',
    request: 'JSON body: { name?: string, color?: string }.',
    response: '{ ok: true, value: { name, color, hasColor, taskCount } }',
    exampleBody: { name: 'design', color: '#ec4899' },
    handler: (call) => {
      const planning = planningOf(call.server)
      const { body, project } = call
      const name = decodeURIComponent(call.params.name!)
      if (body.name === undefined && body.color === undefined)
        throw new Refusal('Send name to rename the label, color to recolour it, or both')
      let label =
        body.name === undefined
          ? null
          : planning.renameLabel(project.id, name, body.name as string, AUTOMATION_ACTOR)
      if (body.color !== undefined)
        label = planning.setLabelColor(project.id, label?.name ?? name, body.color as string)
      setupChanged(call, 'labels', label)
    }
  },
  {
    method: 'DELETE',
    path: '/labels/:name',
    description:
      'Remove a label from every task in the project. The response says what was removed; POST it to /labels/restore to undo.',
    response: '{ ok: true, value: { name, color, workItemIds } }',
    handler: (call) =>
      setupChanged(
        call,
        'labels',
        planningOf(call.server).deleteLabel(
          call.project.id,
          decodeURIComponent(call.params.name!),
          AUTOMATION_ACTOR
        )
      )
  },
  {
    method: 'POST',
    path: '/labels/restore',
    description: 'Undo a label delete: put the label back on those tasks, with its colour.',
    request: 'JSON body: the value DELETE /labels/:name returned.',
    response: '{ ok: true, value: Array<{ name, color, hasColor, taskCount }> }',
    handler: (call) =>
      setupChanged(
        call,
        'labels',
        planningOf(call.server).restoreLabel(
          call.project.id,
          call.body as unknown as PlanningLabelDeletion,
          AUTOMATION_ACTOR
        )
      )
  },
  {
    method: 'GET',
    path: '/fields',
    description:
      "List the project's custom fields, in their order: id, name, type (text | number | date | choice | choices | checkbox) and, for choice and choices, options [{ id, name, color }], and aiInstruction: an AI field's instruction for Ostler AI, or null for an ordinary field (only text and choice fields have one). A task's values are in its fieldValues, by field id: text and date (YYYY-MM-DD) are strings, a number is a number, a checkbox is true, a choice is an option id, choices are a list of option ids. A field with no value has no key. Who filled each value is in the task's fieldFills, by field id: { filledBy: \"person\" | \"ostler-ai\", sourceHash } (sourceHash is a hash of the task's title, description and checklist that Ostler AI filled the value from, null for the person's). A value written through this API is the person's. Filling with Ostler AI is in the app only, never in this API.",
    response: '{ ok: true, value: PlanningFieldDefinition[] }',
    handler: ({ server, res, project }) =>
      respondJson(res, 200, { ok: true, value: planningOf(server).listFields(project.id) })
  },
  {
    method: 'POST',
    path: '/fields',
    description:
      "Add a custom field (at most 20 per project, 50 options per field, names up to 80 characters and unique in the project). A field's type cannot change after it is made.",
    request:
      'JSON body: { name: string, type: "text" | "number" | "date" | "choice" | "choices" | "checkbox", options?: [{ name, color? }], aiInstruction?: string | null (text and choice only, up to 500 characters) }',
    response: '{ ok: true, value: PlanningFieldDefinition }',
    exampleBody: {
      name: 'Size',
      type: 'choice',
      options: [{ name: 'Small' }, { name: 'Large', color: '#ef4444' }]
    },
    handler: (call) =>
      setupChanged(
        call,
        'fields',
        planningOf(call.server).createField(
          call.project.id,
          call.body as unknown as CreatePlanningFieldInput
        )
      )
  },
  {
    method: 'PATCH',
    path: '/fields/:fieldId',
    description:
      'Rename a field, change its options, or give it an AI instruction (aiInstruction; null or "" makes it an ordinary field again, and its values stay). options is the whole new list in order: keep an option by sending its id (renaming it never touches values); an option left out is removed and comes off every task.',
    request:
      'JSON body: { name?: string, options?: [{ id?, name, color? }], aiInstruction?: string | null }',
    response: '{ ok: true, value: PlanningFieldDefinition }',
    exampleBody: { name: 'T-shirt size' },
    handler: (call) =>
      setupChanged(
        call,
        'fields',
        planningOf(call.server).updateField(
          call.project.id,
          call.params.fieldId!,
          call.body as UpdatePlanningFieldInput
        )
      )
  },
  {
    method: 'POST',
    path: '/fields/reorder',
    description: "Put the project's fields in this order (every field id, once).",
    request: 'JSON body: { fieldIds: string[] }',
    response: '{ ok: true, value: PlanningFieldDefinition[] }',
    handler: (call) => {
      if (!Array.isArray(call.body.fieldIds))
        throw new Refusal('fieldIds must be a list of field ids')
      setupChanged(
        call,
        'fields',
        planningOf(call.server).reorderFields(call.project.id, call.body.fieldIds as string[])
      )
    }
  },
  {
    method: 'DELETE',
    path: '/fields/:fieldId',
    description:
      'Delete a field and its values on every task. The response holds the field and its values; POST it to /fields/restore to undo.',
    response: '{ ok: true, value: { field, values } }',
    handler: (call) =>
      setupChanged(
        call,
        'fields',
        planningOf(call.server).deleteField(call.project.id, call.params.fieldId!)
      )
  },
  {
    method: 'POST',
    path: '/fields/restore',
    description: 'Undo a field delete: the field comes back with every value it had.',
    request: 'JSON body: the value DELETE /fields/:fieldId returned.',
    response: '{ ok: true, value: PlanningFieldDefinition }',
    handler: (call) =>
      setupChanged(
        call,
        'fields',
        planningOf(call.server).restoreField(
          call.project.id,
          call.body as unknown as PlanningFieldDeletion
        )
      )
  },
  {
    method: 'GET',
    path: '/columns',
    description:
      "The project's Board columns: names (a display name by status id; a status not listed shows its standard word), hidden (statuses the app hides: only ready, blocked and review) and custom, the project's own columns in Board order (left out when it has none). Each custom column has an id, a name, hidden, and countsAs: the status it counts as. It shows on the Board after that status's column, and a task in it has that status: its columnId names the column. Names are for display only: every status value in this API, in task prompts and in the harness stays the status id (backlog, ready, active, blocked, review, done), so a task in a custom column counting as active is status active to agents, reports and filters by status.",
    response:
      '{ ok: true, value: { names: { [status]: string }, hidden: Array<"ready" | "blocked" | "review">, custom?: Array<{ id: string, name: string, countsAs: status, hidden: boolean }> } }',
    handler: ({ server, res, project }) =>
      respondJson(res, 200, { ok: true, value: planningOf(server).columns.get(project.id) })
  },
  {
    method: 'PATCH',
    path: '/columns',
    description:
      'Rename or hide columns, and add, change, move or delete the project\'s own. names sets display names by status id (up to 40 characters; "" or null restores the standard word); only the statuses you send change. hidden is the whole new list of hidden statuses: only ready, blocked and review can hide. Refused (HTTP 400) while a column to hide holds live tasks (the message says how many), and, while agents are on and the project has a folder, for ready and review. custom is the whole new list of the project\'s own columns (up to 20), in Board order within each status: an entry with a known id keeps that column (renamed, hidden or moved as given); one without an id is a new column; a column left out is deleted, and its tasks go back to the column of the status it counted as. Each needs a name (up to 40 characters, not a standard status word, no two alike, ignoring case) and countsAs, a status id. A custom column holding live tasks cannot hide or change its countsAs.',
    request:
      'JSON body: { names?: { [status]: string | null }, hidden?: Array<"ready" | "blocked" | "review">, custom?: Array<{ id?: string, name: string, countsAs: status, hidden?: boolean }> }',
    response: '{ ok: true, value: { names, hidden, custom? } }',
    exampleBody: { names: { backlog: 'To do', active: 'Doing' }, hidden: ['blocked'] },
    handler: (call) =>
      setupChanged(
        call,
        'columns',
        // This API runs only while agents are on (httpServerPorts), so a
        // project with a folder keeps Ready and In review (D34).
        planningOf(call.server).columns.update(
          call.project.id,
          call.body as UpdatePlanningColumnSettingsInput,
          { agentsLocked: agentColumnsLocked(true, projectFolder(call.project) !== null) }
        )
      )
  }
]
