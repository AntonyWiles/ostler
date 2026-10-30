import type {
  ChangeDetail,
  ChangeHistoryEntry,
  ChangeSubject,
  PlanningPriority,
  PlanningWorkItemStatus
} from '@shared/ostler-api'
import { i18n, t } from '@shared/i18n'
import { formatDate, formatDateTime, formatList } from '@shared/format'
import { taskPriorityLabel } from '@shared/task-labels'

/** A field or a task's part, as the person calls it: "due date", "comments". */
export function changeFieldLabel(field: string): string {
  const key = `views:undoHistory.fields.${field}`
  return i18n.exists(key) ? t(key) : t('views:undoHistory.fields.other')
}

/** Columns that hold on or off, stored as 0 and 1. */
const YES_NO_FIELDS = new Set([
  'hidden',
  'someday',
  'in_triage',
  'enabled',
  'is_me',
  'auto_queue',
  'plan_first'
])
const DAY = /^\d{4}-\d{2}-\d{2}$/
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/**
 * A stored value as the person would write it: a status's column name, a
 * date in their format, "Yes", a list without brackets. Null for nothing.
 */
export function formatChangeValue(
  field: string,
  value: string | null,
  statusLabel: (status: PlanningWorkItemStatus) => string
): string | null {
  if (value === null) return null
  if (field === 'status') return statusLabel(value as PlanningWorkItemStatus)
  if (field === 'priority') return taskPriorityLabel(value as PlanningPriority)
  if (YES_NO_FIELDS.has(field) && /^(0|1|true|false)$/.test(value))
    return value === '1' || value === 'true'
      ? t('views:undoHistory.entry.yes')
      : t('views:undoHistory.entry.no')
  if (DAY.test(value)) return formatDate(new Date(`${value}T00:00:00`))
  if (MOMENT.test(value)) {
    const at = Date.parse(value)
    if (!Number.isNaN(at)) return formatDateTime(at)
  }
  if (value.startsWith('[')) {
    try {
      const list = JSON.parse(value) as unknown
      if (Array.isArray(list) && list.every((item) => ['string', 'number'].includes(typeof item)))
        return list.length === 0 ? null : list.join(', ')
    } catch {
      // Shortened past its end, or not a list: shown as it is.
    }
  }
  return value
}

/** A line in a step's details: a value before and after, or a count of parts with no text. */
export interface ChangeRow {
  field: string
  before: string | null
  after: string | null
  /** "2 added, 4 changed": parts with nothing to show (a drawing's shapes), counted. */
  summary: string | null
}

/**
 * A step's details as lines to show. Parts that have no text of their own
 * (lines and shapes on a whiteboard) would repeat "(empty)" once each, so
 * they are counted on one line per thing and part instead.
 */
export function changeRows(details: ChangeDetail[]): ChangeRow[] {
  const rows: ChangeRow[] = []
  const counts = new Map<
    string,
    { row: ChangeRow; added: number; changed: number; removed: number }
  >()
  for (const detail of details) {
    if (detail.before !== null || detail.after !== null) {
      rows.push({ field: detail.field, before: detail.before, after: detail.after, summary: null })
      continue
    }
    const key = `${detail.kind}|${detail.subjectId}|${detail.field}`
    let count = counts.get(key)
    if (!count) {
      count = {
        row: { field: detail.field, before: null, after: null, summary: null },
        added: 0,
        changed: 0,
        removed: 0
      }
      counts.set(key, count)
      rows.push(count.row)
    }
    count[detail.action] += 1
  }
  for (const { row, added, changed, removed } of counts.values()) {
    const parts: string[] = []
    if (added) parts.push(t('views:undoHistory.entry.partsAdded', { count: added }))
    if (changed) parts.push(t('views:undoHistory.entry.partsChanged', { count: changed }))
    if (removed) parts.push(t('views:undoHistory.entry.partsRemoved', { count: removed }))
    row.summary = parts.join(', ')
  }
  return rows
}

/** "Changed task “Paint the hall”", "Deleted milestone “Launch”". */
export function describeSubject(subject: ChangeSubject): string {
  const kind = t(`views:undoHistory.kinds.${subject.kind}`)
  return subject.name
    ? t(`views:undoHistory.describe.${subject.action}`, { kind, name: subject.name })
    : t(`views:undoHistory.describe.${subject.action}Unnamed`, { kind })
}

/** What the step did, in one line: its one subject, or how many things it changed. */
function describeChange(entry: ChangeHistoryEntry): string {
  if (entry.subjectCount === 1 && entry.subjects[0]) return describeSubject(entry.subjects[0])
  const actions = new Set(entry.subjects.map((subject) => subject.action))
  const count = entry.subjectCount
  if (actions.size === 1 && actions.has('added'))
    return t('views:undoHistory.describe.severalAdded', { count })
  if (actions.size === 1 && actions.has('removed'))
    return t('views:undoHistory.describe.severalRemoved', { count })
  return t('views:undoHistory.describe.several', { count })
}

/** A step as the history and the toolbar name it; an undo reads "Undid: …". */
export function describeEntry(entry: ChangeHistoryEntry): string {
  const step = describeChange(entry)
  if (entry.kind === 'undo') return t('views:undoHistory.describe.undid', { step })
  if (entry.kind === 'redo') return t('views:undoHistory.describe.redid', { step })
  return step
}

/** The step itself, without "Undid:": what a redo puts back or an undo takes out. */
export function describeStep(entry: ChangeHistoryEntry): string {
  return describeChange(entry)
}

/**
 * The line under a step: the fields a single change touched ("Title, due
 * date"), or the things a larger step changed.
 */
export function describeEntryDetail(entry: ChangeHistoryEntry): string | null {
  if (entry.subjectCount === 1) {
    const fields = [...new Set((entry.subjects[0]?.fields ?? []).map(changeFieldLabel))]
    if (fields.length === 0) return null
    const text = formatList(fields)
    return text.charAt(0).toLocaleUpperCase() + text.slice(1)
  }
  const shown = entry.subjects.slice(0, 3).map(describeSubject)
  const more = entry.subjectCount - shown.length
  if (more > 0) shown.push(t('views:undoHistory.entry.andMore', { count: more }))
  return shown.join(' · ')
}
