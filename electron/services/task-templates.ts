import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  CreatePlanningWorkItemInput,
  PlanningActor,
  PlanningFieldDefinition,
  PlanningFieldValue,
  PlanningWorkItem,
  SaveTaskTemplateFromWorkItemInput,
  SaveTaskTemplateInput,
  TaskTemplate,
  TaskTemplateBody,
  TaskTemplateDeletion,
  TaskTemplateOverrides,
  TaskTemplateUse,
  UpdateTaskTemplateInput
} from '@shared/ostler-api'
import { MAX_TASK_TEMPLATES } from '@shared/ostler-api'
import {
  parseTaskTemplateAgent,
  parseTaskTemplateBody,
  parseTaskTemplateName,
  sameTemplateName,
  taskInputFromTemplate,
  taskTemplateBodyFrom
} from '@shared/task-templates'
import { todayIsoDate } from '@shared/dates'
import { resolvePackageDate } from '@shared/relative-dates'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'

interface TemplateRow {
  id: string
  project_id: string | null
  name: string
  body: string
  playbook: number
  created_at: number
  updated_at: number
}

/** What task templates need from the planning service around them; all on its connection. */
export interface TaskTemplatesHost {
  requireProject(projectId: string): void
  getWorkItem(workItemId: string): PlanningWorkItem
  /** A task's live subtasks, in the project's order. */
  subtasksOf(workItem: PlanningWorkItem): PlanningWorkItem[]
  /** The one create path, so activity, reminders, repeats, search and rules see a normal create. */
  createWorkItem(
    projectId: string,
    input: CreatePlanningWorkItemInput,
    actor: PlanningActor
  ): PlanningWorkItem
  runInTransaction<T>(operation: () => T): T
  /** A checklist item's date and person (N2.2), through the one write path. */
  setChecklistItemDetails(
    workItemId: string,
    text: string,
    input: { dueDate: string | null; assigneeId: string | null },
    actor: PlanningActor
  ): PlanningWorkItem
  /** The person exists and can be given work in the project: the address book or its own. */
  personExists(personId: string, projectId: string): boolean
  listFields(projectId: string): PlanningFieldDefinition[]
  /** Whether the field takes this value (a choice's option still exists, say). */
  fieldTakes(projectId: string, fieldId: string, value: PlanningFieldValue): boolean
  /** Task types (N2.7b): a deleted template comes off the types that name it; returns them. */
  templateRemoved(templateId: string): string[]
  /** Undo for that: those types name it again. */
  templateRestored(template: TaskTemplate, typeIds: unknown): void
  /** A template moved to one project comes off other projects' types. */
  templateMoved(templateId: string, projectId: string | null): void
}

/**
 * Task templates (N2.1, N16): one task and its subtasks, saved to make again.
 * A template belongs to one project or to every project. The app, the
 * automation API and the project file all go through here; the body is
 * checked by the one shared validator, `src/shared/task-templates.ts`. Using
 * a template creates through the planning service's `createWorkItem`, in one
 * transaction: a failure leaves nothing half-made.
 */
export class TaskTemplates {
  constructor(
    private readonly db: Database.Database,
    private readonly host: TaskTemplatesHost
  ) {}

  // ─── Stored templates ─────────────────────────────────────────────────────

  /** The templates a project can use: its own and every project's, by name. */
  listForProject(projectId: string): TaskTemplate[] {
    this.host.requireProject(projectId)
    return this.rows(
      'SELECT * FROM planning_task_templates WHERE project_id = ? OR project_id IS NULL',
      projectId
    )
  }

  /** Only a project's own templates (the project file carries these). */
  listOwn(projectId: string): TaskTemplate[] {
    return this.rows('SELECT * FROM planning_task_templates WHERE project_id = ?', projectId)
  }

  /** Every template, for Settings › Projects. */
  listAll(): TaskTemplate[] {
    return this.rows('SELECT * FROM planning_task_templates')
  }

  get(templateId: string): TaskTemplate {
    if (typeof templateId !== 'string' || !templateId)
      throw new Refusal(t('errors:taskTemplates.notFound'))
    const row = this.db
      .prepare('SELECT * FROM planning_task_templates WHERE id = ?')
      .get(templateId) as TemplateRow | undefined
    if (!row) throw new Refusal(t('errors:taskTemplates.notFound'))
    return toTemplate(row)
  }

  /** Refuses a template this project cannot use: another project's. */
  requireUsableIn(templateId: string, projectId: string): TaskTemplate {
    const template = this.get(templateId)
    if (template.projectId !== null && template.projectId !== projectId)
      throw new Refusal(t('errors:taskTemplates.otherProject'))
    return template
  }

  /**
   * Saves a template. A template of the same name in the same scope is
   * refused, or replaced (keeping its id) with `replace`.
   */
  save(input: SaveTaskTemplateInput, now = Date.now()): TaskTemplate {
    const name = parseTaskTemplateName(input?.name)
    const projectId = this.scope(input?.projectId)
    const body = parseTaskTemplateBody(input?.body)
    const playbook = playbookFlag(input?.playbook)
    const clash = this.inScope(projectId).find((other) => sameTemplateName(other.name, name))
    if (clash) {
      if (input.replace !== true) throw new Refusal(t('errors:taskTemplates.nameTaken', { name }))
      const replaced: TaskTemplate = {
        ...clash,
        name,
        body,
        playbook: playbook ?? clash.playbook,
        updatedAt: now
      }
      this.write(replaced)
      return replaced
    }
    if (this.inScope(projectId).length >= MAX_TASK_TEMPLATES)
      throw new Refusal(t('errors:taskTemplates.tooManyTemplates', { max: MAX_TASK_TEMPLATES }))
    const template: TaskTemplate = {
      id: uuidv4(),
      projectId,
      name,
      body,
      playbook: playbook ?? false,
      createdAt: now,
      updatedAt: now
    }
    this.insert(template)
    return template
  }

  /**
   * "Save as task template…": the task and its subtasks as a template. With
   * an agent part, "Save as playbook…" (N9.6b): saved as a playbook.
   */
  saveFromWorkItem(
    workItemId: string,
    input: SaveTaskTemplateFromWorkItemInput,
    today = todayIsoDate(),
    now = Date.now()
  ): TaskTemplate {
    const item = this.host.getWorkItem(workItemId)
    this.host.requireProject(item.projectId)
    if (input?.scope !== 'project' && input?.scope !== 'every')
      throw new Refusal(t('errors:taskTemplates.scopeInvalid'))
    const dateFieldIds = new Set(
      this.host
        .listFields(item.projectId)
        .filter((field) => field.type === 'date')
        .map((field) => field.id)
    )
    const body = taskTemplateBodyFrom(item, this.host.subtasksOf(item), {
      keepDates: input.keepDates === true,
      today,
      dateFieldIds
    })
    const agent = input.agent === undefined ? undefined : parseTaskTemplateAgent(input.agent)
    return this.save(
      {
        name: input.name === undefined || input.name === '' ? item.title : input.name,
        projectId: input.scope === 'every' ? null : item.projectId,
        body: agent ? { ...body, agent } : body,
        ...(agent ? { playbook: true } : {}),
        replace: input.replace
      },
      now
    )
  }

  /** Renames a template, moves it to another scope, or replaces its body. */
  update(templateId: string, updates: UpdateTaskTemplateInput, now = Date.now()): TaskTemplate {
    const current = this.get(templateId)
    const input = (updates ?? {}) as Record<string, unknown>
    const next: TaskTemplate = {
      ...current,
      name: input.name === undefined ? current.name : parseTaskTemplateName(input.name),
      projectId: input.projectId === undefined ? current.projectId : this.scope(input.projectId),
      body: input.body === undefined ? current.body : parseTaskTemplateBody(input.body),
      playbook: playbookFlag(input.playbook) ?? current.playbook,
      updatedAt: now
    }
    const clash = this.inScope(next.projectId).find(
      (other) => other.id !== next.id && sameTemplateName(other.name, next.name)
    )
    if (clash) throw new Refusal(t('errors:taskTemplates.nameTaken', { name: next.name }))
    if (
      next.projectId !== current.projectId &&
      this.inScope(next.projectId).length >= MAX_TASK_TEMPLATES
    )
      throw new Refusal(t('errors:taskTemplates.tooManyTemplates', { max: MAX_TASK_TEMPLATES }))
    this.host.runInTransaction(() => {
      this.write(next)
      if (next.projectId !== current.projectId) this.host.templateMoved(next.id, next.projectId)
    })
    return next
  }

  /** Deletes a template; pass the result to `restore` to undo. */
  delete(templateId: string): TaskTemplateDeletion {
    const template = this.get(templateId)
    const typeIds = this.host.runInTransaction(() => {
      this.db.prepare('DELETE FROM planning_task_templates WHERE id = ?').run(templateId)
      return this.host.templateRemoved(templateId)
    })
    return typeIds.length > 0 ? { template, typeIds } : { template }
  }

  restore(deletion: TaskTemplateDeletion): TaskTemplate {
    const saved = deletion?.template
    if (!saved || typeof saved.id !== 'string' || !saved.id)
      throw new Refusal(t('errors:taskTemplates.notFound'))
    const exists = this.db
      .prepare('SELECT 1 FROM planning_task_templates WHERE id = ?')
      .get(saved.id)
    if (exists) throw new Refusal(t('errors:taskTemplates.alreadyRestored'))
    const projectId = this.scope(saved.projectId)
    const name = parseTaskTemplateName(saved.name)
    if (this.inScope(projectId).some((other) => sameTemplateName(other.name, name)))
      throw new Refusal(t('errors:taskTemplates.nameTaken', { name }))
    const template: TaskTemplate = {
      id: saved.id,
      projectId,
      name,
      body: parseTaskTemplateBody(saved.body),
      playbook: saved.playbook === true,
      createdAt: typeof saved.createdAt === 'number' ? saved.createdAt : Date.now(),
      updatedAt: Date.now()
    }
    this.host.runInTransaction(() => {
      this.insert(template)
      this.host.templateRestored(template, deletion.typeIds)
    })
    return template
  }

  // ─── Using one ────────────────────────────────────────────────────────────

  /**
   * Makes a task, and its subtasks, from a template in one transaction, with
   * dates counted from `today`. `overrides` win over the template. An
   * assignee who is gone, and custom fields the project does not have (or
   * values they no longer take), are dropped and reported, never refused.
   */
  use(
    projectId: string,
    templateId: string,
    actor: PlanningActor,
    overrides: TaskTemplateOverrides = {},
    today = todayIsoDate()
  ): TaskTemplateUse {
    this.host.requireProject(projectId)
    const template = this.requireUsableIn(templateId, projectId)
    return this.make(projectId, template.body, actor, overrides, today)
  }

  /** The same, for a body that is not stored (the project file's own checks have run). */
  make(
    projectId: string,
    rawBody: TaskTemplateBody,
    actor: PlanningActor,
    overrides: TaskTemplateOverrides = {},
    today = todayIsoDate()
  ): TaskTemplateUse {
    const body = parseTaskTemplateBody(rawBody)
    const given = overrides && typeof overrides === 'object' ? overrides : {}
    const fields = this.host.listFields(projectId)
    const dateFieldIds = new Set(
      fields.filter((field) => field.type === 'date').map((field) => field.id)
    )
    const input = taskInputFromTemplate(body, today, given, dateFieldIds)
    const dropped = { assignee: false, fieldCount: 0 }
    if (
      given.assigneeId === undefined &&
      input.assigneeId &&
      !this.host.personExists(input.assigneeId, projectId)
    ) {
      input.assigneeId = null
      dropped.assignee = true
    }
    // Only the template's own values are dropped quietly; the person's are checked as usual.
    const known = new Set(fields.map((field) => field.id))
    const fieldValues: NonNullable<CreatePlanningWorkItemInput['fieldValues']> = {}
    for (const [fieldId, value] of Object.entries(input.fieldValues ?? {})) {
      const fromPerson = given.fieldValues !== undefined && fieldId in given.fieldValues
      if (
        !fromPerson &&
        (!known.has(fieldId) || value === null || !this.host.fieldTakes(projectId, fieldId, value))
      ) {
        if (value !== null) dropped.fieldCount++
        continue
      }
      fieldValues[fieldId] = value
    }
    input.fieldValues = fieldValues
    // Checklist items' dates count from `today`; a person who is gone is left off quietly (N2.2).
    const details = (body.checklistDetails ?? []).flatMap((detail) => {
      if (!(input.acceptanceCriteria ?? []).includes(detail.text)) return []
      const dueDate = resolvePackageDate(detail.dueDate, today)
      const assigneeId =
        detail.assigneeId && this.host.personExists(detail.assigneeId, projectId)
          ? detail.assigneeId
          : null
      return dueDate === null && assigneeId === null
        ? []
        : [{ text: detail.text, dueDate, assigneeId }]
    })
    return this.host.runInTransaction(() => {
      let workItem = this.host.createWorkItem(projectId, input, actor)
      for (const { text, ...detail } of details)
        workItem = this.host.setChecklistItemDetails(workItem.id, text, detail, actor)
      const subtasks = body.subtasks.map((subtask) =>
        this.host.createWorkItem(
          projectId,
          {
            title: subtask.title,
            description: subtask.description,
            acceptanceCriteria: subtask.checklist,
            parentWorkItemId: workItem.id
          },
          actor
        )
      )
      return { workItem, subtasks, dropped }
    })
  }

  // ─── Rows ─────────────────────────────────────────────────────────────────

  /** Null (every project), or a project that exists. */
  private scope(value: unknown): string | null {
    if (value === null) return null
    if (typeof value !== 'string' || !value)
      throw new Refusal(t('errors:taskTemplates.scopeInvalid'))
    this.host.requireProject(value)
    return value
  }

  private inScope(projectId: string | null): TaskTemplate[] {
    return projectId === null
      ? this.rows('SELECT * FROM planning_task_templates WHERE project_id IS NULL')
      : this.listOwn(projectId)
  }

  private rows(sql: string, ...params: unknown[]): TaskTemplate[] {
    const rows = this.db.prepare(sql).all(...params) as TemplateRow[]
    return rows
      .flatMap((row) => {
        try {
          return [toTemplate(row)]
        } catch (error) {
          console.error(`Task template ${row.id} could not be read:`, error)
          return []
        }
      })
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
          a.createdAt - b.createdAt
      )
  }

  private insert(template: TaskTemplate): void {
    this.db
      .prepare(
        `INSERT INTO planning_task_templates
           (id, project_id, name, body, playbook, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        template.id,
        template.projectId,
        template.name,
        JSON.stringify(template.body),
        template.playbook ? 1 : 0,
        template.createdAt,
        template.updatedAt
      )
  }

  private write(template: TaskTemplate): void {
    this.db
      .prepare(
        `UPDATE planning_task_templates
         SET project_id = ?, name = ?, body = ?, playbook = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        template.projectId,
        template.name,
        JSON.stringify(template.body),
        template.playbook ? 1 : 0,
        template.updatedAt,
        template.id
      )
  }
}

function toTemplate(row: TemplateRow): TaskTemplate {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    body: parseTaskTemplateBody(JSON.parse(row.body)),
    playbook: row.playbook === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** Whether to make a template a playbook (N9.6b); undefined leaves it as it is. */
function playbookFlag(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Refusal(t('errors:taskTemplates.playbookInvalid'))
  return value
}
