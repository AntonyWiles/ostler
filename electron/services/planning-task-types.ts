import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  CreatePlanningTaskTypeInput,
  PlanningTaskType,
  PlanningTaskTypeDeletion,
  UpdatePlanningTaskTypeInput
} from '@shared/ostler-api'
import {
  DEFAULT_TASK_TYPE_ICON,
  MAX_TASK_TYPES,
  MAX_TASK_TYPE_NAME_LENGTH,
  isTaskTypeIcon,
  sortTaskTypes,
  taskTypeByName
} from '@shared/task-types'
import { isHexColor, paletteColorFor } from '@shared/project-colors'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'

interface TaskTypeRow {
  id: string
  project_id: string
  name: string
  icon: string
  color: string
  position: number
  field_ids: string | null
  template_id: string | null
  created_at: number
  updated_at: number
}

/** What the task types need from the planning service around them. */
export interface PlanningTaskTypesHost {
  requireProject(projectId: string): void
  changed(projectId: string): void
  /** The project's custom field ids, in its field order (R2.2). */
  fieldIdsOf(projectId: string): string[]
  /** Refuses a task template this project cannot use (N2.1). */
  requireTemplateUsable(templateId: string, projectId: string): void
}

/**
 * Task types (N2.7a, N22), stored. The planning service owns this, so the
 * app, the project file, CSV import and the automation API share one set of
 * rules: at most 20 types a project, names unique within it (ignoring case),
 * an icon from the curated set and a `#rrggbb` colour. Deleting one takes it
 * off its tasks and nothing else; `restore` puts both back.
 *
 * N2.7b: a type can show only some custom fields (`fieldIds`, null for every
 * field) and name a task template new tasks of that type start from. Hiding a
 * field never touches its values. Deleting a field or a template removes it
 * from every type (`removeField`, `removeTemplate`), and their Undo puts it
 * back (`restoreField`, `restoreTemplate`).
 */
export class PlanningTaskTypes {
  constructor(
    private readonly db: Database.Database,
    private readonly host: PlanningTaskTypesHost
  ) {}

  /** A project's types, in its order. */
  list(projectId: string): PlanningTaskType[] {
    this.host.requireProject(projectId)
    return this.rows(projectId)
  }

  get(typeId: string): PlanningTaskType {
    const row =
      typeof typeId === 'string'
        ? (this.db.prepare('SELECT * FROM planning_task_types WHERE id = ?').get(typeId) as
            TaskTypeRow | undefined)
        : undefined
    if (!row) throw new Refusal(t('errors:planningTaskTypes.notFound'))
    this.host.requireProject(row.project_id)
    return toTaskType(row)
  }

  /** Refuses an id that is not one of this project's types. */
  requireInProject(typeId: string, projectId: string): PlanningTaskType {
    if (typeof typeId !== 'string' || typeId.length === 0)
      throw new Refusal(t('errors:planningTaskTypes.notFound'))
    const type = this.get(typeId)
    if (type.projectId !== projectId) throw new Refusal(t('errors:planningTaskTypes.otherProject'))
    return type
  }

  create(
    projectId: string,
    input: CreatePlanningTaskTypeInput,
    now = Date.now()
  ): PlanningTaskType {
    this.host.requireProject(projectId)
    const existing = this.rows(projectId)
    if (existing.length >= MAX_TASK_TYPES)
      throw new Refusal(t('errors:planningTaskTypes.tooMany', { max: MAX_TASK_TYPES }))
    const name = requiredName(input?.name)
    refuseTakenName(existing, name)
    const type: PlanningTaskType = {
      id: uuidv4(),
      projectId,
      name,
      icon: iconName(input?.icon),
      color: colorValue(input?.color, name),
      position: existing.length === 0 ? 0 : Math.max(...existing.map((row) => row.position)) + 1,
      fieldIds: this.fieldIdsValue(projectId, input?.fieldIds),
      templateId: this.templateValue(projectId, input?.templateId),
      createdAt: now,
      updatedAt: now
    }
    this.insert(type)
    this.host.changed(projectId)
    return type
  }

  update(typeId: string, updates: UpdatePlanningTaskTypeInput, now = Date.now()): PlanningTaskType {
    const current = this.get(typeId)
    const input = updates ?? {}
    const name = input.name === undefined ? current.name : requiredName(input.name)
    if (name.toLocaleLowerCase() !== current.name.toLocaleLowerCase())
      refuseTakenName(
        this.rows(current.projectId).filter((other) => other.id !== current.id),
        name
      )
    const type: PlanningTaskType = {
      ...current,
      name,
      icon: input.icon === undefined ? current.icon : iconName(input.icon),
      color: input.color === undefined ? current.color : colorValue(input.color, name),
      fieldIds:
        input.fieldIds === undefined
          ? current.fieldIds
          : this.fieldIdsValue(current.projectId, input.fieldIds),
      templateId:
        input.templateId === undefined
          ? current.templateId
          : this.templateValue(current.projectId, input.templateId),
      updatedAt: now
    }
    this.db
      .prepare(
        `UPDATE planning_task_types
         SET name = ?, icon = ?, color = ?, field_ids = ?, template_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        type.name,
        type.icon,
        type.color,
        fieldIdsColumn(type.fieldIds),
        type.templateId,
        type.updatedAt,
        type.id
      )
    this.host.changed(type.projectId)
    return type
  }

  /** Puts the project's types in this order; `typeIds` must name every one of them once. */
  reorder(projectId: string, typeIds: string[]): PlanningTaskType[] {
    this.host.requireProject(projectId)
    const existing = this.rows(projectId)
    const ids = Array.isArray(typeIds) ? typeIds : []
    const known = new Set(existing.map((type) => type.id))
    if (
      ids.length !== existing.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !known.has(id))
    )
      throw new Refusal(t('errors:planningTaskTypes.reorderMismatch'))
    const put = this.db.prepare('UPDATE planning_task_types SET position = ? WHERE id = ?')
    this.db.transaction(() => ids.forEach((id, index) => put.run(index, id)))()
    this.host.changed(projectId)
    return this.rows(projectId)
  }

  /** Deletes a type; its tasks keep everything but the type. */
  delete(typeId: string): PlanningTaskTypeDeletion {
    const taskType = this.get(typeId)
    const taskIds = (
      this.db.prepare('SELECT id FROM planning_work_items WHERE type_id = ?').all(typeId) as {
        id: string
      }[]
    ).map((row) => row.id)
    this.db.transaction(() => {
      // Not an edit: `updated_at` stays, so Undo leaves the tasks as they were.
      this.db.prepare('UPDATE planning_work_items SET type_id = NULL WHERE type_id = ?').run(typeId)
      this.db.prepare('DELETE FROM planning_task_types WHERE id = ?').run(typeId)
    })()
    this.host.changed(taskType.projectId)
    return { taskType, taskIds }
  }

  /** Undo for `delete`: the type as it was, and its tasks back to it where they still have none. */
  restore(deletion: PlanningTaskTypeDeletion): PlanningTaskType {
    const type = deletion?.taskType
    if (!type || typeof type.id !== 'string')
      throw new Refusal(t('errors:planningTaskTypes.notFound'))
    this.host.requireProject(type.projectId)
    if (this.db.prepare('SELECT 1 FROM planning_task_types WHERE id = ?').get(type.id))
      throw new Refusal(t('errors:planningTaskTypes.alreadyRestored'))
    const existing = this.rows(type.projectId)
    if (existing.length >= MAX_TASK_TYPES)
      throw new Refusal(t('errors:planningTaskTypes.tooMany', { max: MAX_TASK_TYPES }))
    const name = requiredName(type.name)
    refuseTakenName(existing, name)
    const restored: PlanningTaskType = {
      ...type,
      name,
      icon: iconName(type.icon),
      color: colorValue(type.color, name),
      position: Number.isInteger(type.position) ? type.position : existing.length,
      // Fields and a template deleted since are left off rather than refused.
      fieldIds: this.liveFieldIds(type.projectId, type.fieldIds),
      templateId: this.liveTemplate(type.projectId, type.templateId)
    }
    const taskIds = Array.isArray(deletion.taskIds)
      ? deletion.taskIds.filter((id) => typeof id === 'string')
      : []
    this.db.transaction(() => {
      this.insert(restored)
      const put = this.db.prepare(
        'UPDATE planning_work_items SET type_id = ? WHERE id = ? AND project_id = ? AND type_id IS NULL'
      )
      for (const id of taskIds) put.run(restored.id, id, restored.projectId)
    })()
    this.host.changed(restored.projectId)
    return restored
  }

  /** A type's name by id, or null for none or a type that is gone: what agents read (N2.7a). */
  nameOf(typeId: string | null | undefined): string | null {
    if (!typeId) return null
    const row = this.db.prepare('SELECT name FROM planning_task_types WHERE id = ?').get(typeId) as
      { name: string } | undefined
    return row?.name ?? null
  }

  /**
   * The project's type with this name, made if it has none (CSV import and
   * the project file name types, as labels are named).
   */
  ensureByName(projectId: string, name: string, now = Date.now()): PlanningTaskType {
    const found = taskTypeByName(this.list(projectId), name)
    return found ?? this.create(projectId, { name }, now)
  }

  /**
   * Takes a deleted field off every type of its project that shows it, and
   * returns those types, for `restoreField`. A type left with no fields shows
   * none; it never falls back to every field.
   */
  removeField(projectId: string, fieldId: string): string[] {
    const typeIds: string[] = []
    const put = this.db.prepare('UPDATE planning_task_types SET field_ids = ? WHERE id = ?')
    for (const type of this.rows(projectId)) {
      if (!type.fieldIds?.includes(fieldId)) continue
      put.run(fieldIdsColumn(type.fieldIds.filter((id) => id !== fieldId)), type.id)
      typeIds.push(type.id)
    }
    return typeIds
  }

  /** Undo for `removeField`: the field shows on those types again, in the project's order. */
  restoreField(projectId: string, fieldId: string, typeIds: readonly unknown[] | undefined): void {
    if (!Array.isArray(typeIds) || typeIds.length === 0) return
    const order = this.host.fieldIdsOf(projectId)
    const put = this.db.prepare('UPDATE planning_task_types SET field_ids = ? WHERE id = ?')
    for (const type of this.rows(projectId)) {
      if (!typeIds.includes(type.id) || !type.fieldIds || type.fieldIds.includes(fieldId)) continue
      const shown = new Set([...type.fieldIds, fieldId])
      put.run(fieldIdsColumn(order.filter((id) => shown.has(id))), type.id)
    }
  }

  /** Takes a deleted template off every type that names it, and returns those types. */
  removeTemplate(templateId: string): string[] {
    const typeIds = (
      this.db
        .prepare('SELECT id FROM planning_task_types WHERE template_id = ?')
        .all(templateId) as {
        id: string
      }[]
    ).map((row) => row.id)
    this.db
      .prepare('UPDATE planning_task_types SET template_id = NULL WHERE template_id = ?')
      .run(templateId)
    return typeIds
  }

  /**
   * A template moved to one project: types of other projects can no longer
   * use it, so it comes off them.
   */
  templateMoved(templateId: string, projectId: string | null): void {
    if (projectId === null) return
    this.db
      .prepare(
        'UPDATE planning_task_types SET template_id = NULL WHERE template_id = ? AND project_id != ?'
      )
      .run(templateId, projectId)
  }

  /** Undo for `removeTemplate`: those types that still have no template name it again. */
  restoreTemplate(template: { id: string; projectId: string | null }, typeIds: unknown): void {
    if (!Array.isArray(typeIds)) return
    const put = this.db.prepare(
      `UPDATE planning_task_types SET template_id = ?
       WHERE id = ? AND template_id IS NULL AND (? IS NULL OR project_id = ?)`
    )
    for (const id of typeIds)
      if (typeof id === 'string') put.run(template.id, id, template.projectId, template.projectId)
  }

  /** Null for every field, or this project's field ids in its order; anything else is refused. */
  private fieldIdsValue(projectId: string, value: unknown): string[] | null {
    if (value === undefined || value === null) return null
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string'))
      throw new Refusal(t('errors:planningTaskTypes.fieldIdsInvalid'))
    const order = this.host.fieldIdsOf(projectId)
    if (value.some((id) => !order.includes(id)))
      throw new Refusal(t('errors:planningTaskTypes.unknownField'))
    return order.filter((id) => value.includes(id))
  }

  private templateValue(projectId: string, value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string') throw new Refusal(t('errors:taskTemplates.notFound'))
    this.host.requireTemplateUsable(value, projectId)
    return value
  }

  private liveFieldIds(projectId: string, value: unknown): string[] | null {
    if (!Array.isArray(value)) return null
    return this.host.fieldIdsOf(projectId).filter((id) => value.includes(id))
  }

  private liveTemplate(projectId: string, value: unknown): string | null {
    if (typeof value !== 'string' || !value) return null
    try {
      this.host.requireTemplateUsable(value, projectId)
      return value
    } catch {
      return null
    }
  }

  private rows(projectId: string): PlanningTaskType[] {
    const rows = this.db
      .prepare('SELECT * FROM planning_task_types WHERE project_id = ?')
      .all(projectId) as TaskTypeRow[]
    return sortTaskTypes(rows.map(toTaskType))
  }

  private insert(type: PlanningTaskType): void {
    this.db
      .prepare(
        `INSERT INTO planning_task_types
           (id, project_id, name, icon, color, position, field_ids, template_id,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        type.id,
        type.projectId,
        type.name,
        type.icon,
        type.color,
        type.position,
        fieldIdsColumn(type.fieldIds),
        type.templateId,
        type.createdAt,
        type.updatedAt
      )
  }
}

function toTaskType(row: TaskTypeRow): PlanningTaskType {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    position: row.position,
    fieldIds: parseFieldIds(row.field_ids),
    templateId: row.template_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function fieldIdsColumn(fieldIds: string[] | null | undefined): string | null {
  return fieldIds ? JSON.stringify(fieldIds) : null
}

/** The stored list, or null (every field) for none or one that cannot be read. */
function parseFieldIds(value: string | null): string[] | null {
  if (value === null || value === undefined) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : null
  } catch {
    return null
  }
}

function requiredName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Refusal(t('errors:planningTaskTypes.nameRequired'))
  const name = value.trim()
  if (name.length > MAX_TASK_TYPE_NAME_LENGTH)
    throw new Refusal(t('errors:planningTaskTypes.nameTooLong', { max: MAX_TASK_TYPE_NAME_LENGTH }))
  return name
}

function refuseTakenName(types: readonly PlanningTaskType[], name: string): void {
  if (taskTypeByName(types, name))
    throw new Refusal(t('errors:planningTaskTypes.nameTaken', { name }))
}

function iconName(value: unknown): string {
  if (value === undefined || value === null || value === '') return DEFAULT_TASK_TYPE_ICON
  if (!isTaskTypeIcon(value)) throw new Refusal(t('errors:planningTaskTypes.unknownIcon'))
  return value
}

function colorValue(value: unknown, name: string): string {
  if (value === undefined || value === null || value === '') return paletteColorFor(name)
  if (!isHexColor(value)) throw new Refusal(t('errors:planningService.colourMustLookLike'))
  return value.toLowerCase()
}
