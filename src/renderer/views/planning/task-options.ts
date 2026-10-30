import type { PlanningWorkItem } from '@shared/ostler-api'
import { TASK_PRIORITIES, taskPriorityLabel } from '@shared/task-labels'
import type { PeopleState } from '../../context/PeopleContext'
import { t } from '@shared/i18n'

/**
 * People to offer for filtering or assigning: everyone not archived, plus
 * archived people who still have work in this view.
 */
export function peopleOptions(people: PeopleState, workItems: readonly PlanningWorkItem[]) {
  const assigned = new Set(workItems.map((item) => item.assigneeId))
  return people.all
    .filter((person) => person.archivedAt === null || assigned.has(person.id))
    .map((person) => ({
      value: person.id,
      label: person.isMe ? t('tasks:taskOptions.you', { personName: person.name }) : person.name
    }))
}

/** Priorities, highest first, as select options. */
export const PRIORITY_OPTIONS = [...TASK_PRIORITIES].reverse().map((priority) => ({
  value: priority,
  get label() {
    return taskPriorityLabel(priority)
  }
}))
