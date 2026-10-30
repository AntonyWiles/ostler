/**
 * Custom fields (R2.2, D32): a project's own task fields. Tasks only; never
 * milestones, goals or decisions. A field's type is fixed when it is made.
 */
export type PlanningFieldType = 'text' | 'number' | 'date' | 'choice' | 'choices' | 'checkbox'

export const PLANNING_FIELD_TYPES: readonly PlanningFieldType[] = [
  'text',
  'number',
  'date',
  'choice',
  'choices',
  'checkbox'
]

/** At most this many fields per project (D32). */
export const MAX_PROJECT_FIELDS = 20
/** At most this many options per Choice or Choices field (D32). */
export const MAX_FIELD_OPTIONS = 50
export const MAX_FIELD_NAME_LENGTH = 80
export const MAX_FIELD_OPTION_LENGTH = 80
export const MAX_FIELD_TEXT_LENGTH = 1000
/** The longest instruction an AI field (N8.4) can have. */
export const MAX_AI_INSTRUCTION_LENGTH = 500
/** The longest text Ostler AI puts in a Text field (N8.4); a longer answer is cut. */
export const MAX_AI_FIELD_ANSWER_LENGTH = 500

/** One option of a Choice or Choices field. Values hold its id, so a rename touches no value. */
export interface PlanningFieldOption {
  id: string
  name: string
  /** `#rrggbb`, from the shared palette. */
  color: string
}

export interface PlanningFieldDefinition {
  id: string
  projectId: string
  /** The person's own words: never translated. */
  name: string
  type: PlanningFieldType
  /** Choice and Choices only; empty for the other types. */
  options: PlanningFieldOption[]
  /** 0-based place among the project's fields. */
  position: number
  createdAt: number
  /**
   * An AI field's instruction for Ostler AI (N8.4, N58): "Which room is this
   * for?". Text and Choice fields only; null (or absent) is an ordinary field.
   */
  aiInstruction?: string | null
}

/**
 * A value as stored: text (Text), a number (Number), `YYYY-MM-DD` (Date), an
 * option id (Choice), option ids in the field's order (Choices), or `true`
 * (Checkbox). An empty value is absent, never stored.
 */
export type PlanningFieldValue = string | number | boolean | string[]

/** A task's values, by field id. A field with no value has no key. */
export type PlanningFieldValues = Record<string, PlanningFieldValue>

/** Who filled a value (N8.4): the person, or Ostler AI when they asked it to. */
export type PlanningFieldFiller = 'person' | 'ostler-ai'

/**
 * Who filled one value (N8.4). `sourceHash` is, for Ostler AI's, a short hash
 * of the task's title, description and checklist it was filled from
 * (`aiFieldSourceHash`): when the task's text differs now, the value may be
 * out of date. Null for the person's.
 */
export interface PlanningFieldFill {
  filledBy: PlanningFieldFiller
  sourceHash: string | null
}

/** Who filled each of a task's values, by field id: one entry per value. */
export type PlanningFieldFills = Record<string, PlanningFieldFill>

/** What a write sends, by field id: `null` (or an empty value) clears it. */
export type PlanningFieldValuesInput = Record<string, PlanningFieldValue | null>

/** An option in a create or update: with `id` it is an existing option, without one a new one. */
export interface PlanningFieldOptionInput {
  id?: string
  name: string
  color?: string
}

export interface CreatePlanningFieldInput {
  name: string
  type: PlanningFieldType
  options?: PlanningFieldOptionInput[]
  /** Makes it an AI field (N8.4): Text and Choice only, up to 500 characters. */
  aiInstruction?: string | null
}

/**
 * `options` is the whole new list, in order: an option left out is removed,
 * and its value comes off every task that had it.
 */
export interface UpdatePlanningFieldInput {
  name?: string
  options?: PlanningFieldOptionInput[]
  /** The instruction (N8.4); null or "" makes it an ordinary field again. */
  aiInstruction?: string | null
}

/** One value Ostler AI suggested, which the person's Fill with AI saves (N8.4). */
export interface AiFieldFillInput {
  workItemId: string
  /** The stored form, or null to leave it empty. */
  value: PlanningFieldValue | null
  /** `sourceHash` of the task text the suggestion was made from. */
  sourceHash: string
}

/**
 * What saving a batch of Ostler AI's values did (N8.4). `before` is what
 * `restoreAiFieldFills` puts back: one undo for the whole batch.
 */
export interface AiFieldFillResult {
  filled: string[]
  /** Tasks left alone: a value the person entered (not confirmed), or a task that is gone. */
  skipped: { workItemId: string; reason: 'personValue' | 'notFound' | 'hidden' }[]
  before: AiFieldFillUndo
}

export interface AiFieldFillUndo {
  fieldId: string
  values: {
    workItemId: string
    value: PlanningFieldValue | null
    filledBy: PlanningFieldFiller
    sourceHash: string | null
  }[]
}

/**
 * Ostler AI's answer for one task's AI field (N8.4). Nothing is saved: the
 * value is a suggestion until the person's Fill with AI saves it. `note`
 * says why the value is empty: the answer was not one of the options, or
 * there was no answer.
 */
export interface AiFieldSuggestion {
  workItemId: string
  fieldId: string
  value: PlanningFieldValue | null
  note: 'notAnOption' | 'noAnswer' | null
  sourceHash: string
}

/** What deleting a field took away, so Undo can put it back with every value. */
export interface PlanningFieldDeletion {
  field: PlanningFieldDefinition
  values: { workItemId: string; value: PlanningFieldValue }[]
  /** The task types that showed it (N2.7b), so Undo shows it there again. */
  typeIds?: string[]
}
