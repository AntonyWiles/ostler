import type { PlanningWorkItem } from '../ostler-api'

/**
 * Find and replace (N2.5, decision N20): every match of a plain text in a
 * project's task titles, descriptions and checklist items, and the new values
 * a chosen set of matches gives a task. Pure, so the app's preview, its apply
 * and the automation API find the same matches. Comments, the Library and
 * decisions are never searched. The find text is plain text, never a pattern.
 */

/** The limits the planning service holds a task's text to. */
export const FIND_REPLACE_LIMITS = {
  title: 200,
  description: 8000,
  checklistItem: 500,
  find: 500
} as const

/** How many characters of the text around a match the snippet shows. */
export const SNIPPET_CONTEXT = 40

export interface FindReplaceOptions {
  matchCase?: boolean
  wholeWords?: boolean
}

export type FindReplaceField = 'title' | 'description' | 'checklist'

/** Why a match cannot be replaced: replacing it would break a rule. */
export type FindReplaceProblem =
  | 'titleEmpty'
  | 'titleTooLong'
  | 'descriptionTooLong'
  | 'checklistEmpty'
  | 'checklistTooLong'
  | 'checklistDuplicate'

/** The task text find and replace reads and writes. */
export type FindReplaceTask = Pick<
  PlanningWorkItem,
  'id' | 'title' | 'description' | 'acceptanceCriteria'
> & { archivedAt?: number | null }

export interface FindReplaceMatch {
  /** Stable for the same task text: `taskId:field[:item]:start`. */
  id: string
  taskId: string
  taskTitle: string
  archived: boolean
  field: FindReplaceField
  /** The checklist item's place in the list, for `checklist`. */
  itemIndex: number | null
  /** Where the match starts in its field's text, and the text it matched. */
  start: number
  text: string
  /** The text around the match, cut to `SNIPPET_CONTEXT` characters each side. */
  before: string
  after: string
  /** Whether the snippet was cut before or after. */
  cutBefore: boolean
  cutAfter: boolean
  /** Set when replacing this match would break a rule; it cannot be chosen. */
  problem: FindReplaceProblem | null
}

/** A task's text fields, as stored. */
export interface FindReplaceFields {
  title: string
  description: string
  acceptanceCriteria: string[]
}

/** One task's change: undo sends `undoTextChanges` of it. */
export interface FindReplaceChange {
  id: string
  from: FindReplaceFields
  to: FindReplaceFields
  /** Checklist items renamed, `[from, to]`, so their ticks go with them. */
  renamed: [string, string][]
}

export interface FindReplaceResult {
  changed: FindReplaceChange[]
  skipped: { id: string; title: string; reason: 'changed' | 'missing' | 'invalid' }[]
}

/** What to find, as the app and the automation API send it. */
export interface FindReplaceRequest extends FindReplaceOptions {
  find: string
  replace: string
  includeArchived?: boolean
}

/** What a preview found. */
export interface FindReplacePreview {
  matches: FindReplaceMatch[]
  /** How many tasks have a match. */
  taskCount: number
  /** True when there were more matches than a preview returns. */
  truncated: boolean
}

/** A chosen match, as the preview gave it. */
export type FindReplaceChoice = Pick<
  FindReplaceMatch,
  'taskId' | 'field' | 'itemIndex' | 'start' | 'text'
>

const WORD = /[\p{L}\p{N}_]/u

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Every place `find` occurs in `text`, left to right, never overlapping. */
export function findInText(text: string, find: string, options: FindReplaceOptions = {}): number[] {
  if (!find || !text) return []
  // An escaped expression: plain text, with case folding that keeps positions.
  const pattern = new RegExp(escapeRegExp(find), options.matchCase ? 'gu' : 'giu')
  const starts: number[] = []
  for (const found of text.matchAll(pattern)) {
    const start = found.index
    const end = start + found[0].length
    if (options.wholeWords) {
      const before = start > 0 ? text.slice(Math.max(0, start - 2), start) : ''
      const after = text.slice(end, end + 2)
      if (before && WORD.test([...before].pop()!)) continue
      if (after && WORD.test([...after][0]!)) continue
    }
    starts.push(start)
  }
  return starts
}

/** `text` with `find`'s matches at `starts` replaced by `replace`. */
export function replaceAt(
  text: string,
  starts: readonly number[],
  length: number,
  replace: string
): string {
  let result = text
  for (const start of [...starts].sort((a, b) => b - a))
    result = result.slice(0, start) + replace + result.slice(start + length)
  return result
}

function fieldText(task: FindReplaceTask, field: FindReplaceField, itemIndex: number | null) {
  if (field === 'title') return task.title
  if (field === 'description') return task.description ?? ''
  return task.acceptanceCriteria[itemIndex ?? -1]
}

/** Whether `next`, the new text of a field, breaks a rule. */
function problemFor(
  task: FindReplaceTask,
  field: FindReplaceField,
  itemIndex: number | null,
  next: string
): FindReplaceProblem | null {
  const value = next.trim()
  if (field === 'title') {
    if (!value) return 'titleEmpty'
    return value.length > FIND_REPLACE_LIMITS.title ? 'titleTooLong' : null
  }
  if (field === 'description')
    return value.length > FIND_REPLACE_LIMITS.description ? 'descriptionTooLong' : null
  if (!value) return 'checklistEmpty'
  if (value.length > FIND_REPLACE_LIMITS.checklistItem) return 'checklistTooLong'
  // Ticks are keyed by an item's text: two items with one text would merge.
  return task.acceptanceCriteria.some((other, index) => index !== itemIndex && other === value)
    ? 'checklistDuplicate'
    : null
}

/** Every match in `tasks`, task by task, title then description then checklist. */
export function findMatches(
  tasks: readonly FindReplaceTask[],
  find: string,
  replace: string,
  options: FindReplaceOptions = {}
): FindReplaceMatch[] {
  const matches: FindReplaceMatch[] = []
  if (!find) return matches
  for (const task of tasks) {
    const fields: [FindReplaceField, number | null, string][] = [
      ['title', null, task.title],
      ['description', null, task.description ?? ''],
      ...task.acceptanceCriteria.map((item, index): [FindReplaceField, number | null, string] => [
        'checklist',
        index,
        item
      ])
    ]
    for (const [field, itemIndex, text] of fields) {
      for (const start of findInText(text, find, options)) {
        const end = start + find.length
        const from = Math.max(0, start - SNIPPET_CONTEXT)
        const to = Math.min(text.length, end + SNIPPET_CONTEXT)
        matches.push({
          id: matchId(task.id, field, itemIndex, start),
          taskId: task.id,
          taskTitle: task.title,
          archived: Boolean(task.archivedAt),
          field,
          itemIndex,
          start,
          text: text.slice(start, end),
          before: text.slice(from, start),
          after: text.slice(end, to),
          cutBefore: from > 0,
          cutAfter: to < text.length,
          problem: problemFor(
            task,
            field,
            itemIndex,
            replaceAt(text, [start], find.length, replace)
          )
        })
      }
    }
  }
  return matches
}

export function matchId(
  taskId: string,
  field: FindReplaceField,
  itemIndex: number | null,
  start: number
): string {
  return field === 'checklist'
    ? `${taskId}:checklist:${itemIndex}:${start}`
    : `${taskId}:${field}:${start}`
}

/** A task's text fields. */
export function textFields(task: FindReplaceTask): FindReplaceFields {
  return {
    title: task.title,
    description: task.description ?? '',
    acceptanceCriteria: [...task.acceptanceCriteria]
  }
}

/**
 * The new text of `task` with the chosen `matches` (all of this task)
 * replaced. `'changed'` when a field no longer holds a match's text at its
 * place (the task changed since the preview); `'invalid'` when the result
 * breaks a rule (an empty or too long title, two checklist items alike).
 */
export function applyMatches(
  task: FindReplaceTask,
  matches: readonly Pick<FindReplaceMatch, 'field' | 'itemIndex' | 'start' | 'text'>[],
  replace: string
): FindReplaceChange | 'changed' | 'invalid' {
  const from = textFields(task)
  const groups = new Map<
    string,
    { field: FindReplaceField; itemIndex: number | null; starts: number[]; length: number }
  >()
  for (const match of matches) {
    const text = fieldText(task, match.field, match.itemIndex)
    if (
      text === undefined ||
      text.slice(match.start, match.start + match.text.length) !== match.text
    )
      return 'changed'
    const key = `${match.field}:${match.itemIndex}`
    const group = groups.get(key) ?? {
      field: match.field,
      itemIndex: match.itemIndex,
      starts: [],
      length: match.text.length
    }
    if (group.length !== match.text.length) return 'changed'
    group.starts.push(match.start)
    groups.set(key, group)
  }
  const to = textFields(task)
  const renamed: [string, string][] = []
  for (const { field, itemIndex, starts, length } of groups.values()) {
    const text = fieldText(task, field, itemIndex)!
    const sorted = [...new Set(starts)].sort((a, b) => a - b)
    if (sorted.some((start, index) => index > 0 && start < sorted[index - 1]! + length))
      return 'changed'
    const next = replaceAt(text, sorted, length, replace).trim()
    if (field === 'title') to.title = next
    else if (field === 'description') to.description = next
    else {
      to.acceptanceCriteria[itemIndex!] = next
      if (next !== text) renamed.push([text, next])
    }
  }
  if (!to.title || to.title.length > FIND_REPLACE_LIMITS.title) return 'invalid'
  if (to.description.length > FIND_REPLACE_LIMITS.description) return 'invalid'
  if (
    to.acceptanceCriteria.some(
      (item) => !item || item.length > FIND_REPLACE_LIMITS.checklistItem
    ) ||
    new Set(to.acceptanceCriteria).size !== to.acceptanceCriteria.length
  )
    return 'invalid'
  return { id: task.id, from, to, renamed }
}

/** Whether a task's text is still exactly `fields`. */
export function sameFields(task: FindReplaceTask, fields: FindReplaceFields): boolean {
  return (
    task.title === fields.title &&
    (task.description ?? '') === fields.description &&
    task.acceptanceCriteria.length === fields.acceptanceCriteria.length &&
    task.acceptanceCriteria.every((item, index) => item === fields.acceptanceCriteria[index])
  )
}

/** The changes that put applied ones back. */
export function undoTextChanges(changes: readonly FindReplaceChange[]): FindReplaceChange[] {
  return changes.map(({ id, from, to, renamed }) => ({
    id,
    from: to,
    to: from,
    renamed: renamed.map(([before, after]): [string, string] => [after, before])
  }))
}
