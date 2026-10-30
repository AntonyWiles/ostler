import type { CreatePlanningWorkItemInput, PlanningWorkItem } from '@shared/ostler-api'

export interface TaskCopyOptions {
  /** The copy's title: Copy task marks it "(copy)", a new round keeps it. */
  title: string
  /** The copy's milestone: Copy task keeps the task's, a round's copies go to the round. */
  milestoneId?: string | null
  /** The copy's iteration: Copy task keeps the task's; left out (a round), none. */
  iterationId?: string | null
  /** Moves each of the copy's dates (a new round); left out, they stay as they are. */
  shiftDate?: (value: string) => string
}

/**
 * What a copy of a task is made from (N2.4's Copy task and N5.7a's rounds,
 * one path): the description, the checklist (unticked: a new task has no
 * ticks), labels, priority, estimate, person, dates, custom field values and
 * the task's type, in Backlog, the first column. Comments, activity,
 * attachments, time entries, agent links, the parent, waits-on links and
 * the repeat stay behind. The milestone and iteration are each caller's to
 * give. A field added to tasks later is copied by adding it here.
 */
export function taskCopyInput(
  source: PlanningWorkItem,
  options: TaskCopyOptions
): CreatePlanningWorkItemInput {
  const shift = options.shiftDate ?? ((value: string) => value)
  const date = (value: string | null | undefined) => (value ? shift(value) : null)
  return {
    title: options.title,
    description: source.description,
    status: 'backlog',
    priority: source.priority,
    labels: source.labels,
    acceptanceCriteria: source.acceptanceCriteria,
    assigneeId: source.assigneeId,
    estimate: source.estimate,
    startDate: date(source.startDate),
    targetDate: date(source.targetDate),
    showFrom: date(source.showFrom),
    fieldValues: source.fieldValues ?? {},
    typeId: source.typeId ?? null,
    ...(options.milestoneId !== undefined ? { milestoneId: options.milestoneId } : {}),
    ...(options.iterationId !== undefined ? { iterationId: options.iterationId } : {})
  }
}
