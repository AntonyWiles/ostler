import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  CreatePlanningFieldInput,
  PlanningFieldDefinition,
  PlanningFieldDeletion,
  PlanningFieldFiller,
  PlanningFieldFills,
  PlanningFieldOption,
  PlanningFieldOptionInput,
  PlanningFieldType,
  PlanningFieldValue,
  PlanningFieldValues,
  PlanningFieldValuesInput,
  UpdatePlanningFieldInput
} from '@shared/ostler-api'
import {
  MAX_FIELD_NAME_LENGTH,
  MAX_FIELD_OPTION_LENGTH,
  MAX_FIELD_OPTIONS,
  MAX_PROJECT_FIELDS,
  PLANNING_FIELD_TYPES
} from '@shared/ostler-api'
import { hasOptions, normalizeFieldValue } from '@shared/planning/custom-fields'
import { normalizeAiInstruction } from '@shared/planning/ai-fields'
import { isHexColor, paletteColorFor } from '@shared/project-colors'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'

interface FieldRow {
  id: string
  project_id: string
  name: string
  type: PlanningFieldType
  options: string
  position: number
  created_at: number
  ai_instruction: string | null
}

interface ValueRow {
  work_item_id: string
  field_id: string
  text_value: string | null
  number_value: number | null
}

interface FillRow {
  work_item_id: string
  field_id: string
  filled_by: PlanningFieldFiller
  source_hash: string | null
}

/** Who fills a write's values (N8.4): the person, unless it saves Ostler AI's suggestion. */
export interface FieldFiller {
  filledBy: PlanningFieldFiller
  sourceHash: string | null
}

const PERSON: FieldFiller = { filledBy: 'person', sourceHash: null }

/**
 * Custom fields (R2.2, D32): a project's field definitions and its tasks'
 * values. The planning service owns this and calls it from its own write
 * points, so every surface goes through the same validation
 * (`normalizeFieldValue`) and the same storage.
 *
 * Storage: one value row per task and field, or one per ticked option of a
 * Choices field. Text, dates and option ids go in `text_value`; numbers and a
 * ticked checkbox in `number_value`. An empty value has no row.
 */
export class PlanningFields {
  constructor(private readonly db: Database.Database) {}

  // ─── Definitions ──────────────────────────────────────────────────────────

  list(projectId: string): PlanningFieldDefinition[] {
    return (
      this.db
        .prepare('SELECT * FROM planning_fields WHERE project_id = ? ORDER BY position, created_at')
        .all(projectId) as FieldRow[]
    ).map(toDefinition)
  }

  get(fieldId: string): PlanningFieldDefinition {
    if (typeof fieldId !== 'string') throw new Refusal(t('errors:customFields.fieldNotFound'))
    const row = this.db.prepare('SELECT * FROM planning_fields WHERE id = ?').get(fieldId) as
      FieldRow | undefined
    if (!row) throw new Refusal(t('errors:customFields.fieldNotFound'))
    return toDefinition(row)
  }

  /** The field, refused unless it is one of `projectId`'s. */
  getForProject(projectId: string, fieldId: string): PlanningFieldDefinition {
    const field = this.get(fieldId)
    if (field.projectId !== projectId) throw new Refusal(t('errors:customFields.fieldNotInProject'))
    return field
  }

  create(projectId: string, input: CreatePlanningFieldInput): PlanningFieldDefinition {
    const existing = this.list(projectId)
    if (existing.length >= MAX_PROJECT_FIELDS)
      throw new Refusal(t('errors:customFields.tooManyFields', { max: MAX_PROJECT_FIELDS }))
    const type = input?.type
    if (!PLANNING_FIELD_TYPES.includes(type))
      throw new Refusal(
        t('errors:customFields.unknownType', { types: PLANNING_FIELD_TYPES.join(', ') })
      )
    const name = this.fieldName(input.name, existing, null)
    if (!hasOptions(type) && input.options !== undefined && input.options.length > 0)
      throw new Refusal(t('errors:customFields.optionsOnlyForChoice'))
    const field: PlanningFieldDefinition = {
      id: uuidv4(),
      projectId,
      name,
      type,
      options: hasOptions(type) ? this.options(name, input.options ?? [], []) : [],
      position: existing.length,
      createdAt: Date.now(),
      aiInstruction: normalizeAiInstruction(type, input.aiInstruction)
    }
    this.insert(field)
    return field
  }

  /**
   * Renames a field or changes its options. An option left out of `options`
   * is removed, and its value comes off every task. The type never changes.
   */
  update(fieldId: string, input: UpdatePlanningFieldInput): PlanningFieldDefinition {
    const current = this.get(fieldId)
    if (
      (input as { type?: unknown })?.type !== undefined &&
      (input as { type?: unknown }).type !== current.type
    )
      throw new Refusal(t('errors:customFields.typeCannotChange'))
    const name =
      input.name === undefined
        ? current.name
        : this.fieldName(input.name, this.list(current.projectId), current.id)
    if (input.options !== undefined && !hasOptions(current.type))
      throw new Refusal(t('errors:customFields.optionsOnlyForChoice'))
    const options =
      input.options === undefined
        ? current.options
        : this.options(name, input.options, current.options)
    const aiInstruction =
      input.aiInstruction === undefined
        ? (current.aiInstruction ?? null)
        : normalizeAiInstruction(current.type, input.aiInstruction)
    const field = { ...current, name, options, aiInstruction }
    this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE planning_fields SET name = ?, options = ?, ai_instruction = ? WHERE id = ?'
        )
        .run(field.name, JSON.stringify(field.options), field.aiInstruction, field.id)
      const kept = new Set(options.map((option) => option.id))
      const removed = current.options.filter((option) => !kept.has(option.id))
      const drop = this.db.prepare(
        'DELETE FROM planning_field_values WHERE field_id = ? AND text_value = ?'
      )
      for (const option of removed) drop.run(field.id, option.id)
    })()
    return field
  }

  /** Puts the project's fields in this order. `fieldIds` names every field once. */
  reorder(projectId: string, fieldIds: string[]): PlanningFieldDefinition[] {
    const fields = this.list(projectId)
    if (
      !Array.isArray(fieldIds) ||
      fieldIds.length !== fields.length ||
      new Set(fieldIds).size !== fields.length ||
      !fieldIds.every((id) => fields.some((field) => field.id === id))
    )
      throw new Refusal(t('errors:customFields.reorderNeedsEveryField'))
    const write = this.db.prepare('UPDATE planning_fields SET position = ? WHERE id = ?')
    this.db.transaction(() => fieldIds.forEach((id, index) => write.run(index, id)))()
    return this.list(projectId)
  }

  /** Deletes a field and its values; the result is what `restore` puts back. */
  delete(fieldId: string): PlanningFieldDeletion {
    const field = this.get(fieldId)
    const values = this.valuesForField(field)
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM planning_fields WHERE id = ?').run(fieldId)
      this.renumber(field.projectId)
    })()
    return { field, values }
  }

  /**
   * Undoes `delete`: the field comes back at its place, with its values on
   * the tasks that still exist. Refused if the project has since reached the
   * limit or used the name.
   */
  restore(projectId: string, deletion: PlanningFieldDeletion): PlanningFieldDefinition {
    const field = deletion?.field
    if (!field || field.projectId !== projectId || typeof field.id !== 'string')
      throw new Refusal(t('errors:customFields.fieldNotFound'))
    const existing = this.list(projectId)
    if (existing.some((other) => other.id === field.id)) return this.get(field.id)
    if (existing.length >= MAX_PROJECT_FIELDS)
      throw new Refusal(t('errors:customFields.tooManyFields', { max: MAX_PROJECT_FIELDS }))
    const restored: PlanningFieldDefinition = {
      ...field,
      name: this.fieldName(field.name, existing, null),
      options: hasOptions(field.type) ? this.options(field.name, field.options, field.options) : [],
      position: Math.min(Math.max(0, Math.floor(field.position)), existing.length),
      aiInstruction: normalizeAiInstruction(field.type, field.aiInstruction)
    }
    const live = this.db.prepare(
      'SELECT 1 FROM planning_work_items WHERE id = ? AND project_id = ?'
    )
    this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE planning_fields SET position = position + 1 WHERE project_id = ? AND position >= ?'
        )
        .run(projectId, restored.position)
      this.insert(restored)
      for (const { workItemId, value } of deletion.values ?? []) {
        if (typeof workItemId !== 'string' || !live.get(workItemId, projectId)) continue
        const normalized = normalizeFieldValue(restored, value)
        if (normalized !== null) this.writeValue(projectId, workItemId, restored, normalized)
      }
      this.renumber(projectId)
    })()
    return this.get(restored.id)
  }

  private insert(field: PlanningFieldDefinition): void {
    this.db
      .prepare(
        `INSERT INTO planning_fields (id, project_id, name, type, options, position, created_at, ai_instruction)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        field.id,
        field.projectId,
        field.name,
        field.type,
        JSON.stringify(field.options),
        field.position,
        field.createdAt,
        field.aiInstruction ?? null
      )
  }

  private renumber(projectId: string): void {
    const write = this.db.prepare('UPDATE planning_fields SET position = ? WHERE id = ?')
    this.list(projectId).forEach((field, index) => write.run(index, field.id))
  }

  private fieldName(
    value: unknown,
    existing: PlanningFieldDefinition[],
    ownId: string | null
  ): string {
    const name = typeof value === 'string' ? value.trim() : ''
    if (!name) throw new Refusal(t('errors:customFields.nameRequired'))
    if (name.length > MAX_FIELD_NAME_LENGTH)
      throw new Refusal(t('errors:customFields.nameTooLong', { max: MAX_FIELD_NAME_LENGTH }))
    const lower = name.toLowerCase()
    if (existing.some((field) => field.id !== ownId && field.name.toLowerCase() === lower))
      throw new Refusal(t('errors:customFields.nameTaken', { name }))
    return name
  }

  private options(
    fieldName: string,
    input: PlanningFieldOptionInput[],
    current: PlanningFieldOption[]
  ): PlanningFieldOption[] {
    if (!Array.isArray(input))
      throw new Refusal(t('errors:customFields.needsOptions', { name: fieldName }))
    if (input.length > MAX_FIELD_OPTIONS)
      throw new Refusal(t('errors:customFields.tooManyOptions', { max: MAX_FIELD_OPTIONS }))
    const seen = new Set<string>()
    const ids = new Set<string>()
    return input.map((option) => {
      const name = typeof option?.name === 'string' ? option.name.trim() : ''
      if (!name) throw new Refusal(t('errors:customFields.optionNameRequired'))
      if (name.length > MAX_FIELD_OPTION_LENGTH)
        throw new Refusal(
          t('errors:customFields.optionNameTooLong', { max: MAX_FIELD_OPTION_LENGTH })
        )
      const lower = name.toLowerCase()
      if (seen.has(lower))
        throw new Refusal(
          t('errors:customFields.optionNameTaken', { name: fieldName, option: name })
        )
      seen.add(lower)
      // An id the field does not have (or a repeat) makes a new option.
      const id =
        typeof option.id === 'string' &&
        !ids.has(option.id) &&
        current.some((o) => o.id === option.id)
          ? option.id
          : uuidv4()
      ids.add(id)
      if (option.color !== undefined && !isHexColor(option.color))
        throw new Refusal(t('errors:customFields.optionColorInvalid'))
      const color = (
        option.color ??
        current.find((o) => o.id === id)?.color ??
        paletteColorFor(name)
      ).toLowerCase()
      return { id, name, color }
    })
  }

  // ─── Values ───────────────────────────────────────────────────────────────

  /** Every task's values in a project, in one query: task id → values. */
  valuesForProject(projectId: string): Map<string, PlanningFieldValues> {
    const fields = new Map(this.list(projectId).map((field) => [field.id, field]))
    const rows = this.db
      .prepare(
        'SELECT work_item_id, field_id, text_value, number_value FROM planning_field_values WHERE project_id = ? ORDER BY rowid'
      )
      .all(projectId) as ValueRow[]
    return collect(rows, fields)
  }

  /** One task's values. */
  valuesForWorkItem(projectId: string, workItemId: string): PlanningFieldValues {
    const fields = new Map(this.list(projectId).map((field) => [field.id, field]))
    const rows = this.db
      .prepare(
        'SELECT work_item_id, field_id, text_value, number_value FROM planning_field_values WHERE work_item_id = ? ORDER BY rowid'
      )
      .all(workItemId) as ValueRow[]
    return collect(rows, fields).get(workItemId) ?? {}
  }

  /** Who filled every value in a project (N8.4), in one query: task id → fills. */
  fillsForProject(projectId: string): Map<string, PlanningFieldFills> {
    return collectFills(
      this.db
        .prepare(
          'SELECT DISTINCT work_item_id, field_id, filled_by, source_hash FROM planning_field_values WHERE project_id = ?'
        )
        .all(projectId) as FillRow[]
    )
  }

  /** Who filled one task's values. */
  fillsForWorkItem(workItemId: string): PlanningFieldFills {
    return (
      collectFills(
        this.db
          .prepare(
            'SELECT DISTINCT work_item_id, field_id, filled_by, source_hash FROM planning_field_values WHERE work_item_id = ?'
          )
          .all(workItemId) as FillRow[]
      ).get(workItemId) ?? {}
    )
  }

  /**
   * Checks values a write sends (by field id) and returns them in stored form,
   * with `null` for a value to clear. Refuses an unknown field, or a value the
   * field does not take. Writes nothing.
   */
  validate(
    projectId: string,
    input: PlanningFieldValuesInput | undefined
  ): Map<string, PlanningFieldValue | null> {
    const result = new Map<string, PlanningFieldValue | null>()
    if (input === undefined) return result
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Refusal(t('errors:customFields.valuesMustBeObject'))
    const fields = new Map(this.list(projectId).map((field) => [field.id, field]))
    for (const [fieldId, raw] of Object.entries(input)) {
      const field = fields.get(fieldId)
      if (!field) throw new Refusal(t('errors:customFields.fieldNotInProject'))
      result.set(fieldId, normalizeFieldValue(field, raw))
    }
    return result
  }

  /**
   * Writes checked values (from `validate`) for one task. Every write is the
   * person's, so editing a value Ostler AI filled makes it theirs (N8.4);
   * only saving Ostler AI's suggestion passes `filler`.
   */
  write(
    projectId: string,
    workItemId: string,
    values: Map<string, PlanningFieldValue | null>,
    filler: FieldFiller = PERSON
  ): void {
    if (values.size === 0) return
    const fields = new Map(this.list(projectId).map((field) => [field.id, field]))
    const clear = this.db.prepare(
      'DELETE FROM planning_field_values WHERE work_item_id = ? AND field_id = ?'
    )
    for (const [fieldId, value] of values) {
      const field = fields.get(fieldId)
      if (!field) continue
      clear.run(workItemId, fieldId)
      if (value !== null) this.writeValue(projectId, workItemId, field, value, filler)
    }
  }

  /**
   * Marks values already written as filled by someone else (N8.4): a project
   * file or template bringing Ostler AI's values with who filled them, or an
   * undo putting a mark back. Values with no row are left alone.
   */
  markFilled(workItemId: string, fills: PlanningFieldFills): void {
    const mark = this.db.prepare(
      'UPDATE planning_field_values SET filled_by = ?, source_hash = ? WHERE work_item_id = ? AND field_id = ?'
    )
    for (const [fieldId, fill] of Object.entries(fills))
      mark.run(fill.filledBy, fill.sourceHash, workItemId, fieldId)
  }

  private writeValue(
    projectId: string,
    workItemId: string,
    field: PlanningFieldDefinition,
    value: PlanningFieldValue,
    filler: FieldFiller = PERSON
  ): void {
    const insert = this.db.prepare(
      `INSERT INTO planning_field_values (project_id, work_item_id, field_id, text_value, number_value, filled_by, source_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const run = (text: string | null, number: number | null) =>
      insert.run(projectId, workItemId, field.id, text, number, filler.filledBy, filler.sourceHash)
    switch (field.type) {
      case 'number':
        run(null, Number(value))
        break
      case 'checkbox':
        run(null, 1)
        break
      case 'choices':
        for (const id of value as string[]) run(id, null)
        break
      default:
        run(String(value), null)
    }
  }

  private valuesForField(field: PlanningFieldDefinition): PlanningFieldDeletion['values'] {
    const rows = this.db
      .prepare(
        'SELECT work_item_id, field_id, text_value, number_value FROM planning_field_values WHERE field_id = ? ORDER BY rowid'
      )
      .all(field.id) as ValueRow[]
    return [...collect(rows, new Map([[field.id, field]]))].map(([workItemId, values]) => ({
      workItemId,
      value: values[field.id]
    }))
  }
}

function toDefinition(row: FieldRow): PlanningFieldDefinition {
  let options: PlanningFieldOption[] = []
  try {
    const parsed = JSON.parse(row.options) as unknown
    if (Array.isArray(parsed)) options = parsed as PlanningFieldOption[]
  } catch {
    options = []
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    type: row.type,
    options,
    position: row.position,
    createdAt: row.created_at,
    aiInstruction: row.ai_instruction ?? null
  }
}

function collectFills(rows: FillRow[]): Map<string, PlanningFieldFills> {
  const byTask = new Map<string, PlanningFieldFills>()
  for (const row of rows) {
    let fills = byTask.get(row.work_item_id)
    if (!fills) byTask.set(row.work_item_id, (fills = {}))
    fills[row.field_id] = { filledBy: row.filled_by, sourceHash: row.source_hash ?? null }
  }
  return byTask
}

/** Value rows as task id → values, read by each field's type. */
function collect(
  rows: ValueRow[],
  fields: Map<string, PlanningFieldDefinition>
): Map<string, PlanningFieldValues> {
  const byTask = new Map<string, PlanningFieldValues>()
  for (const row of rows) {
    const field = fields.get(row.field_id)
    if (!field) continue
    let values = byTask.get(row.work_item_id)
    if (!values) byTask.set(row.work_item_id, (values = {}))
    switch (field.type) {
      case 'number':
        if (row.number_value !== null) values[field.id] = row.number_value
        break
      case 'checkbox':
        values[field.id] = true
        break
      case 'choices': {
        if (row.text_value === null) break
        const list = (values[field.id] as string[] | undefined) ?? []
        list.push(row.text_value)
        values[field.id] = list
        break
      }
      default:
        if (row.text_value !== null) values[field.id] = row.text_value
    }
  }
  // Choices in the field's own order.
  for (const values of byTask.values())
    for (const [fieldId, value] of Object.entries(values)) {
      const field = fields.get(fieldId)
      if (field?.type === 'choices' && Array.isArray(value))
        values[fieldId] = field.options.map((o) => o.id).filter((id) => value.includes(id))
    }
  return byTask
}
