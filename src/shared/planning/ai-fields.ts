import type {
  PlanningFieldDefinition,
  PlanningFieldFill,
  PlanningFieldType,
  PlanningFieldValue,
  PlanningWorkItem
} from '../ostler-api'
import { MAX_AI_FIELD_ANSWER_LENGTH, MAX_AI_INSTRUCTION_LENGTH } from '../ostler-api'
import { Refusal } from '../refusal'
import { t } from '../i18n'

/**
 * AI fields (N8.4, N58 choice A): the one rule for which fields can have an
 * instruction, what one request about a task sends, how an answer becomes a
 * value, and when a value Ostler AI filled may be out of date. Ostler AI fills
 * only when the person asks; it suggests, and the person's Fill with AI saves.
 */

/** At most this many tasks in one bulk Fill with AI. */
export const MAX_AI_FILL_BATCH = 100

/** Only Text and Choice fields can be AI fields. */
export function canHaveAiInstruction(type: PlanningFieldType): boolean {
  return type === 'text' || type === 'choice'
}

/** Whether the field is an AI field. */
export function isAiField(field: Pick<PlanningFieldDefinition, 'type' | 'aiInstruction'>): boolean {
  return canHaveAiInstruction(field.type) && Boolean(field.aiInstruction)
}

/**
 * The stored form of an instruction: trimmed, null for none. Refuses one on a
 * type that cannot have it, or one that is too long.
 */
export function normalizeAiInstruction(type: PlanningFieldType, raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') throw new Refusal(t('errors:aiFields.instructionNeedsText'))
  const text = raw.trim()
  if (text === '') return null
  if (!canHaveAiInstruction(type)) throw new Refusal(t('errors:aiFields.onlyTextOrChoice'))
  if (text.length > MAX_AI_INSTRUCTION_LENGTH)
    throw new Refusal(t('errors:aiFields.instructionTooLong', { max: MAX_AI_INSTRUCTION_LENGTH }))
  return text
}

type TaskText = Pick<PlanningWorkItem, 'title' | 'description' | 'acceptanceCriteria'>

/**
 * A short hash (8 hex digits, FNV-1a) of the task text a value is filled
 * from: its title, description and checklist. The same in main and the
 * renderer, so a value can say it may be out of date without a call.
 */
export function aiFieldSourceHash(item: TaskText): string {
  const text = [item.title, item.description ?? '', ...(item.acceptanceCriteria ?? [])].join(
    '\u0000'
  )
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Whether a value is Ostler AI's. */
export function isAiFilled(fill: PlanningFieldFill | undefined): boolean {
  return fill?.filledBy === 'ostler-ai'
}

/** Whether Ostler AI's value was filled from text the task no longer has. */
export function isAiFillOutOfDate(fill: PlanningFieldFill | undefined, item: TaskText): boolean {
  return isAiFilled(fill) && fill!.sourceHash !== aiFieldSourceHash(item)
}

/**
 * Everything one request sends (N8.4, "What is sent"): the field's name,
 * instruction and, for Choice, its option names; the task's title,
 * description and checklist. Nothing else: no other field's value, nor this
 * field's own earlier value, comments, costs, contacts or events.
 */
export interface AiFieldRequest {
  fieldName: string
  instruction: string
  /** Choice only: the option names, one of which must be the answer. */
  options: string[] | null
  title: string
  description: string
  checklist: string[]
}

export function aiFieldRequest(field: PlanningFieldDefinition, item: TaskText): AiFieldRequest {
  if (!isAiField(field)) throw new Refusal(t('errors:aiFields.notAnAiField', { name: field.name }))
  return {
    fieldName: field.name,
    instruction: field.aiInstruction ?? '',
    options: field.type === 'choice' ? field.options.map((option) => option.name) : null,
    title: item.title,
    description: item.description ?? '',
    checklist: [...(item.acceptanceCriteria ?? [])]
  }
}

/**
 * The model's answer (its `answer` string, or null) as a value for the
 * field, checked against the field's type before anything is stored: a
 * Choice answer that is not one of the options is left empty with a note, a
 * Text answer is cut to 500 characters.
 */
export function readAiFieldAnswer(
  field: PlanningFieldDefinition,
  answer: unknown
): { value: PlanningFieldValue | null; note: 'notAnOption' | 'noAnswer' | null } {
  const text = typeof answer === 'string' ? answer.trim() : ''
  if (text === '') return { value: null, note: 'noAnswer' }
  if (field.type === 'choice') {
    const wanted = text.toLowerCase()
    const option = field.options.find((candidate) => candidate.name.toLowerCase() === wanted)
    return option ? { value: option.id, note: null } : { value: null, note: 'notAnOption' }
  }
  return { value: text.slice(0, MAX_AI_FIELD_ANSWER_LENGTH).trim(), note: null }
}
