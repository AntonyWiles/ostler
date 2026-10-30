import type { PlanningPriority, PlanningWorkItemStatus } from './ostler-api'
import { TASK_CONTACT_ROLES, isTaskContactRole } from './contacts'
import { ITERATION_CURRENT } from './planning/iterations'
import { findPerson } from './quick-add'
import {
  ASSIGNEE_ME,
  ASSIGNEE_NOBODY,
  EMPTY_TASK_FILTER,
  FIELD_SPECS,
  NO_RECORD,
  isConditionComplete,
  opSpec,
  parseTaskFilter,
  type FilterValueKind,
  type TaskFilter,
  type TaskFilterCondition,
  type TaskFilterField
} from './task-filter'

/**
 * Describe it (N8.1, N55): the person describes a filter in words, Ostler AI
 * answers with a filter written in the grammar below, and this file turns the
 * answer into an ordinary `TaskFilter`. The grammar is generated from
 * `FIELD_SPECS`, so a new filter field reaches the model without a change
 * here. Names in the answer are mapped to ids within their own field only, and
 * every condition then goes through `parseTaskFilter`, the parser saved views
 * and the automation API use. The answer is data: anything that cannot be
 * mapped or parsed is dropped, with a note that says what.
 */

/** The longest description the box sends. */
export const FILTER_WORDS_MAX_TEXT = 500
/** At most this many names of each kind go to the model. */
export const FILTER_VOCABULARY_CAP = 200

export interface FilterFromWordsRequest {
  text: string
  /** Today where the person is, `YYYY-MM-DD`. */
  today: string
  /** The first day of the person's week: 0 Sunday … 6 Saturday. */
  weekStart: number
}

/** The project's names: everything the model learns about the project. */
export interface FilterVocabulary {
  /** Each status's key and the project's word for it (R2.4). */
  statuses: Array<{ value: PlanningWorkItemStatus; name: string }>
  priorities: Array<{ value: PlanningPriority; name: string }>
  labels: string[]
  milestones: Array<{ id: string; name: string }>
  goals: Array<{ id: string; name: string }>
  iterations: Array<{ id: string; name: string }>
  /** The project's task types (N2.7a); absent reads as none. */
  types?: Array<{ id: string; name: string }>
  /** The project's workstreams (sub-projects); absent reads as none. */
  subprojects?: Array<{ id: string; name: string }>
  people: Array<{ id: string; name: string; initials?: string; isMe?: boolean }>
  /** Contacts (N6.5), by name, as people are; absent reads as none. */
  contacts?: Array<{ id: string; name: string }>
}

/** The lists `capVocabulary` can cut: each has its own note in words. */
export const FILTER_VOCABULARY_LISTS = [
  'labels',
  'milestones',
  'goals',
  'iterations',
  'types',
  'people',
  'contacts'
] as const

export type FilterVocabularyList = (typeof FILTER_VOCABULARY_LISTS)[number]

/** Why part of the answer was left out, for the box to say in words. */
export type FilterWordsNote =
  /** A name the project has no record of, in that field. */
  | { kind: 'unknownName'; field: TaskFilterField; name: string }
  /** A condition the filter parser refused, or a field Ostler does not have. */
  | { kind: 'unusable'; field: string }
  /** The project has more names of a kind than were sent. */
  | { kind: 'cut'; list: FilterVocabularyList; sent: number }

export interface FilterFromWordsResult {
  filter: TaskFilter
  notes: FilterWordsNote[]
  model: string
}

/**
 * The vocabulary with each list cut to `FILTER_VOCABULARY_CAP`, and a note
 * for each list that was cut.
 */
export function capVocabulary(vocabulary: FilterVocabulary): {
  vocabulary: FilterVocabulary
  notes: FilterWordsNote[]
} {
  const notes: FilterWordsNote[] = []
  const cap = <T>(list: FilterVocabularyList, values: T[]): T[] => {
    if (values.length <= FILTER_VOCABULARY_CAP) return values
    notes.push({ kind: 'cut', list, sent: FILTER_VOCABULARY_CAP })
    return values.slice(0, FILTER_VOCABULARY_CAP)
  }
  return {
    vocabulary: {
      statuses: vocabulary.statuses,
      priorities: vocabulary.priorities,
      labels: cap('labels', vocabulary.labels),
      milestones: cap('milestones', vocabulary.milestones),
      goals: cap('goals', vocabulary.goals),
      iterations: cap('iterations', vocabulary.iterations),
      types: cap('types', vocabulary.types ?? []),
      people: cap('people', vocabulary.people),
      contacts: cap('contacts', vocabulary.contacts ?? [])
    },
    notes
  }
}

/** What a value of each kind is, for the model. Every kind has a line, so a new one fails to build. */
const KIND_GRAMMAR: Record<FilterValueKind, string> = {
  text: 'a word or phrase to look for in the task',
  statuses: 'a list of status keys from STATUSES',
  priorities: 'a list of priority keys from PRIORITIES',
  people: `a list of names from PEOPLE, "${ASSIGNEE_ME}" (the person asking) or "${ASSIGNEE_NOBODY}" (unassigned)`,
  labels: 'a list of names from LABELS',
  milestones: `a list of names from MILESTONES, or "${NO_RECORD}"`,
  goals: `a list of names from GOALS, or "${NO_RECORD}"`,
  iterations: `a list of names from ITERATIONS, "${ITERATION_CURRENT}" or "${NO_RECORD}"`,
  types: `a list of names from TYPES, or "${NO_RECORD}"`,
  subprojects: `a list of workstream names, or "${NO_RECORD}"`,
  relativeDate: 'one of the relative dates listed',
  date: 'a date written YYYY-MM-DD',
  number: 'a number',
  estimatePresence: '"set" or "empty"',
  checklist: '"complete" or "incomplete"',
  boolean: 'true or false',
  numberRange: 'two numbers, [low, high]',
  presence: '"empty" or "set"',
  options: 'a list of option names',
  resolution: '"wont-do"',
  contacts: `a list of names from CONTACTS, each alone or written "<name>:<role>" for a contact in that role (${TASK_CONTACT_ROLES.join(', ')})`
}

/**
 * The filter grammar, one line per field and operator, from `FIELD_SPECS`:
 * `due before: a date written YYYY-MM-DD`.
 */
export function filterGrammar(): string {
  return FIELD_SPECS.flatMap((spec) =>
    spec.ops.map((op) => {
      const relative = op.kind === 'relativeDate' ? `: ${(op.relative ?? []).join(', ')}` : ''
      return `- ${spec.field} ${op.op}: ${KIND_GRAMMAR[op.kind]}${relative}`
    })
  ).join('\n')
}

const squash = (value: string) => value.trim().toLowerCase()

/** The first entry whose name is `name`, ignoring case. */
function byName<T>(entries: readonly T[], name: string, nameOf: (entry: T) => string): T | null {
  const wanted = squash(name)
  return entries.find((entry) => squash(nameOf(entry)) === wanted) ?? null
}

/**
 * One name in a list value, mapped within its field to what a condition
 * stores: a status or priority key, a label, an id, or a special value.
 * Null when the project has nothing of that name in that field.
 */
function mapName(kind: FilterValueKind, name: string, vocabulary: FilterVocabulary): string | null {
  const special = squash(name)
  switch (kind) {
    case 'statuses':
      return (
        byName(vocabulary.statuses, name, (entry) => entry.value)?.value ??
        byName(vocabulary.statuses, name, (entry) => entry.name)?.value ??
        null
      )
    case 'priorities':
      return (
        byName(vocabulary.priorities, name, (entry) => entry.value)?.value ??
        byName(vocabulary.priorities, name, (entry) => entry.name)?.value ??
        null
      )
    case 'people':
      if (special === ASSIGNEE_ME) return ASSIGNEE_ME
      if (special === ASSIGNEE_NOBODY) return ASSIGNEE_NOBODY
      return findPerson(name, vocabulary.people)?.id ?? null
    case 'labels':
      return byName(vocabulary.labels, name, (label) => label)
    case 'milestones':
      if (special === NO_RECORD) return NO_RECORD
      return byName(vocabulary.milestones, name, (entry) => entry.name)?.id ?? null
    case 'goals':
      if (special === NO_RECORD) return NO_RECORD
      return byName(vocabulary.goals, name, (entry) => entry.name)?.id ?? null
    case 'iterations':
      if (special === NO_RECORD) return NO_RECORD
      if (special === ITERATION_CURRENT) return ITERATION_CURRENT
      return byName(vocabulary.iterations, name, (entry) => entry.name)?.id ?? null
    case 'types':
      if (special === NO_RECORD) return NO_RECORD
      return byName(vocabulary.types ?? [], name, (entry) => entry.name)?.id ?? null
    case 'subprojects':
      if (special === NO_RECORD) return NO_RECORD
      return byName(vocabulary.subprojects ?? [], name, (entry) => entry.name)?.id ?? null
    case 'contacts': {
      const contacts = vocabulary.contacts ?? []
      const whole = byName(contacts, name, (entry) => entry.name)
      if (whole) return whole.id
      // "<name>:<role>": the contact in that role, as a condition stores it.
      const colon = name.lastIndexOf(':')
      const role = name.slice(colon + 1).trim()
      if (colon <= 0 || !isTaskContactRole(role)) return null
      const named = byName(contacts, name.slice(0, colon), (entry) => entry.name)
      return named ? `${named.id}:${role}` : null
    }
    default:
      return name
  }
}

/** Value kinds that are lists of names: an unknown one gives an `unknownName` note. */
export const LIST_KINDS: readonly FilterValueKind[] = [
  'statuses',
  'priorities',
  'people',
  'labels',
  'milestones',
  'goals',
  'iterations',
  'types',
  'subprojects',
  'contacts'
]

/**
 * The model's answer as a filter, mapped and checked. Each condition is
 * parsed on its own, so one bad condition costs only itself.
 */
export function readFilterAnswer(
  raw: unknown,
  vocabulary: FilterVocabulary
): { filter: TaskFilter; notes: FilterWordsNote[] } {
  const notes: FilterWordsNote[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { filter: EMPTY_TASK_FILTER, notes }
  }
  const input = raw as { match?: unknown; conditions?: unknown }
  const match = input.match === 'any' ? 'any' : 'all'
  const list = Array.isArray(input.conditions) ? input.conditions.slice(0, 30) : []
  const conditions: TaskFilterCondition[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const { field, op, value } = entry as Record<string, unknown>
    const fieldName = typeof field === 'string' ? field.slice(0, 40) : ''
    const spec = typeof op === 'string' ? opSpec(field as TaskFilterField, op as never) : undefined
    if (!spec || field === 'custom') {
      notes.push({ kind: 'unusable', field: fieldName })
      continue
    }
    let mapped: unknown = value
    if (LIST_KINDS.includes(spec.kind)) {
      const names = (Array.isArray(value) ? value : [value]).filter(
        (name): name is string => typeof name === 'string' && name.trim() !== ''
      )
      const ids: string[] = []
      for (const name of names) {
        const id = mapName(spec.kind, name, vocabulary)
        if (id === null) {
          notes.push({
            kind: 'unknownName',
            field: field as TaskFilterField,
            name: name.slice(0, 80)
          })
        } else if (!ids.includes(id)) ids.push(id)
      }
      // Every name was unknown: those notes say why the condition is gone.
      if (ids.length === 0) {
        if (names.length === 0) notes.push({ kind: 'unusable', field: fieldName })
        continue
      }
      mapped = ids
    }
    try {
      const [condition] = parseTaskFilter({
        match: 'all',
        conditions: [{ field, op, value: mapped }]
      }).conditions
      if (isConditionComplete(condition)) conditions.push(condition)
      else notes.push({ kind: 'unusable', field: fieldName })
    } catch {
      notes.push({ kind: 'unusable', field: fieldName })
    }
  }
  return { filter: { match, conditions }, notes }
}
