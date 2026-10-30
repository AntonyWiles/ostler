import type { PlanningWorkItem } from '../ostler-api'
import { formatIsoDate } from '../dates'
import { t } from '../i18n'

/**
 * Show-from dates and Someday (N1.1a, N9): the one rule for "available now".
 * Home, My work, the Board, the List, the filters, auto-queue and queueing
 * by hand all ask these, so a task is hidden in the same places everywhere.
 */

export type ShowFromTask = Pick<PlanningWorkItem, 'showFrom' | 'someday' | 'inTriage'>

/**
 * Why a task is hidden today, or null when it is available. A task in To
 * triage (N4.3a) is hidden everywhere until it is accepted: the same rule
 * keeps it out of Home, My work, the matrix and the agents' queue.
 */
export type HiddenReason =
  { kind: 'triage' } | { kind: 'someday' } | { kind: 'later'; showFrom: string }

/**
 * Whether `task` is hidden on `today` (the person's local date, `YYYY-MM-DD`):
 * it is in Someday, or its show-from date is after today.
 */
export function isHiddenNow(task: ShowFromTask, today: string): boolean {
  return hiddenReason(task, today) !== null
}

/** Why `task` is hidden on `today`; triage wins, then Someday, then a show-from date. */
export function hiddenReason(task: ShowFromTask, today: string): HiddenReason | null {
  if (task.inTriage) return { kind: 'triage' }
  if (task.someday) return { kind: 'someday' }
  if (task.showFrom && task.showFrom > today) return { kind: 'later', showFrom: task.showFrom }
  return null
}

/** Whether a task becomes available on `today`: its show-from date is today and it is not in Someday. */
export function isNewToday(task: ShowFromTask, today: string): boolean {
  return !task.inTriage && !task.someday && task.showFrom === today
}

/** How many of `tasks` are hidden on `today`, split by reason, for "12 hidden until later". */
export function countHidden(
  tasks: readonly ShowFromTask[],
  today: string
): { later: number; someday: number } {
  let later = 0
  let someday = 0
  for (const task of tasks) {
    const reason = hiddenReason(task, today)
    if (reason?.kind === 'someday') someday++
    else if (reason?.kind === 'later') later++
  }
  return { later, someday }
}

/**
 * Why an agent may not take `task` on `today`, in plain words, or null when
 * it may: "Bring it back from Someday first", "It is hidden until 1 March".
 * Queueing by hand refuses with this (`queueWorkItemForHarness`), and the app
 * offers to bring the task back and queue it in one step.
 */
export function hiddenQueueRefusal(task: ShowFromTask, today: string): string | null {
  const reason = hiddenReason(task, today)
  if (!reason) return null
  if (reason.kind === 'triage') return t('errors:showFrom.inTriage')
  if (reason.kind === 'someday') return t('errors:showFrom.inSomeday')
  return t('errors:showFrom.hiddenUntil', {
    date: formatIsoDate(reason.showFrom, { day: 'numeric', month: 'long' })
  })
}
