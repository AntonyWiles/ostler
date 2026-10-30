import type {
  CreatePlanningWorkItemInput,
  PlanningFieldDefinition,
  PlanningTaskType
} from './ostler-api'

/*
 * Fields and templates by task type (N2.7b, N22): one rule for which custom
 * fields a task shows, used by the drawer, New task and the plan grid alike.
 * A task with no type, or a type that names no list (`fieldIds: null`), shows
 * every field. Hiding a field never touches its values.
 */

type TypeLike = Pick<PlanningTaskType, 'id' | 'fieldIds'>

/** The type with this id, or null for none or one that is gone. */
export function taskTypeOf<T extends Pick<PlanningTaskType, 'id'>>(
  types: readonly T[],
  typeId: string | null | undefined
): T | null {
  if (!typeId) return null
  return types.find((type) => type.id === typeId) ?? null
}

/** Whether a task of this type shows the field. */
export function typeShowsField(type: TypeLike | null | undefined, fieldId: string): boolean {
  return !type || !type.fieldIds || type.fieldIds.includes(fieldId)
}

/** The fields a task of this type shows, in the project's order. */
export function fieldsForType<F extends Pick<PlanningFieldDefinition, 'id'>>(
  fields: readonly F[],
  type: TypeLike | null | undefined
): F[] {
  return fields.filter((field) => typeShowsField(type, field.id))
}

/** The fields a task of this type hides, in the project's order. */
export function fieldsHiddenByType<F extends Pick<PlanningFieldDefinition, 'id'>>(
  fields: readonly F[],
  type: TypeLike | null | undefined
): F[] {
  return fields.filter((field) => !typeShowsField(type, field.id))
}

/**
 * Whether a field's value, saved or still being typed, holds something: an
 * empty text, an unticked checkbox or no choices hold nothing.
 */
export function fieldHoldsValue(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length > 0
  return true
}

/**
 * The fields a task of this type hides that hold a value (the drawer's note
 * counts only these: what the person cannot see and might miss).
 */
export function hiddenFieldsWithValues<F extends Pick<PlanningFieldDefinition, 'id'>>(
  fields: readonly F[],
  type: TypeLike | null | undefined,
  values: Readonly<Record<string, unknown>>
): F[] {
  return fieldsHiddenByType(fields, type).filter((field) => fieldHoldsValue(values[field.id]))
}

/**
 * The fields offered for tasks of several types at once (the plan grid's
 * columns): every field one of them shows. Any task with no type shows all.
 */
export function fieldsForTypes<F extends Pick<PlanningFieldDefinition, 'id'>>(
  fields: readonly F[],
  types: ReadonlyArray<TypeLike | null | undefined>
): F[] {
  if (types.length === 0) return [...fields]
  return fields.filter((field) => types.some((type) => typeShowsField(type, field.id)))
}

function filled(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  return true
}

/**
 * New task's form after choosing a type whose template is `template` (N2.7b):
 * the template fills what the person has not, and what the person entered
 * wins. A priority still at the form's default counts as not entered.
 */
export function fillFromTypeTemplate(
  entries: CreatePlanningWorkItemInput,
  template: CreatePlanningWorkItemInput,
  defaultPriority: CreatePlanningWorkItemInput['priority'] = 'medium'
): CreatePlanningWorkItemInput {
  const pick = <K extends keyof CreatePlanningWorkItemInput>(key: K) =>
    filled(entries[key]) ? entries[key] : template[key]
  const fieldValues: NonNullable<CreatePlanningWorkItemInput['fieldValues']> = {
    ...(template.fieldValues ?? {})
  }
  for (const [fieldId, value] of Object.entries(entries.fieldValues ?? {}))
    if (filled(value)) fieldValues[fieldId] = value
  return {
    ...entries,
    title: pick('title') ?? '',
    description: pick('description'),
    priority:
      entries.priority && entries.priority !== defaultPriority
        ? entries.priority
        : (template.priority ?? entries.priority),
    labels: pick('labels'),
    acceptanceCriteria: pick('acceptanceCriteria'),
    assigneeId: pick('assigneeId'),
    startDate: pick('startDate'),
    targetDate: pick('targetDate'),
    estimate: pick('estimate'),
    fieldValues
  }
}
