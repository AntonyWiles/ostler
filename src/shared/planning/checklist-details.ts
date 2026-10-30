import { daysFromToday, formatIsoDate, formatIsoDateShort } from '../dates'
import { t } from '../i18n'
import type { PlanningChecklistDetail, PlanningWorkItem } from '../ostler-api/planning-types'

/**
 * A checklist item's date as its chip says it (N2.2): "Today", "Tomorrow",
 * the weekday in the coming week ("Fri"), else the short date ("8 Oct").
 */
export function checklistDateLabel(value: string, today: Date = new Date()): string {
  const days = daysFromToday(value, today)
  if (days === 0) return t('common:date.today')
  if (days === 1) return t('common:date.tomorrow')
  if (days !== null && days > 1 && days < 7) return formatIsoDate(value, { weekday: 'short' })
  return formatIsoDateShort(value, today)
}

/**
 * The task's next dated, unticked checklist item when it comes before the
 * task's own due date, or the task has none (N2.2): the card's "Next: …".
 */
export function nextDatedChecklistItem(
  item: Pick<PlanningWorkItem, 'checklistDetails' | 'checkedCriteria' | 'targetDate'>
): (PlanningChecklistDetail & { dueDate: string }) | null {
  const ticked = new Set(item.checkedCriteria)
  let next: (PlanningChecklistDetail & { dueDate: string }) | null = null
  for (const detail of item.checklistDetails ?? []) {
    if (!detail.dueDate || ticked.has(detail.text)) continue
    if (!next || detail.dueDate < next.dueDate) next = { ...detail, dueDate: detail.dueDate }
  }
  if (!next) return null
  return item.targetDate && next.dueDate >= item.targetDate ? null : next
}

export interface ChecklistRename {
  from: string
  to: string
}

/**
 * The one item renamed between two saved checklists (N2.2): the same length,
 * one place whose text changed to one not elsewhere on the list. Null for any
 * other change (added, removed, moved, or more than one edited).
 */
export function checklistRename(before: string[], after: string[]): ChecklistRename | null {
  if (before.length !== after.length) return null
  const changed = before.flatMap((text, index) => (text !== after[index] ? [index] : []))
  if (changed.length !== 1) return null
  const from = before[changed[0]!]!
  const to = after[changed[0]!]!
  if (before.includes(to) || after.includes(from)) return null
  return { from, to }
}
