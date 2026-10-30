import type { AssignedTask } from '../ostler-api'
import { compareIsoDates } from '../dates'
import { TASK_PRIORITIES, TASK_STATUSES, taskPriorityLabel, taskStatusLabel } from '../task-labels'
import { t } from '../i18n'
import { DUE_BUCKETS, dueBucket } from './list'

/**
 * My work's rules (R3.1): how its tasks group and sort. Pure, so the view and
 * its tests answer the same way. Due groups are the List's own buckets
 * (`dueBucket`), so "This week" means the same thing in both.
 */

export const MY_WORK_GROUP_BY = ['due', 'project', 'status', 'priority', 'none'] as const
export type MyWorkGroupBy = (typeof MY_WORK_GROUP_BY)[number]

export function isMyWorkGroupBy(value: unknown): value is MyWorkGroupBy {
  return (MY_WORK_GROUP_BY as readonly unknown[]).includes(value)
}

export function myWorkGroupByLabel(groupBy: MyWorkGroupBy): string {
  return t(`views:myWork.groupBy.${groupBy}`)
}

/** My work's columns, in order. Custom fields are per project, so they are not columns here. */
export const MY_WORK_COLUMN_IDS = [
  'title',
  'project',
  'status',
  'due',
  'start',
  'priority',
  'assignee',
  'milestone',
  'estimate'
] as const
export type MyWorkColumnId = (typeof MY_WORK_COLUMN_IDS)[number]

export function isMyWorkColumnId(value: unknown): value is MyWorkColumnId {
  return (MY_WORK_COLUMN_IDS as readonly unknown[]).includes(value)
}

export interface MyWorkGroup {
  key: string
  label: string
  /** The project's colour, for a project group. */
  color?: string
  tasks: AssignedTask[]
}

/**
 * Tasks in groups, in a fixed order: due buckets from Overdue to No date
 * (seen from `today`, local time), projects by name, statuses and priorities
 * in the app's order. Only groups with tasks are returned.
 */
export function groupMyWork(
  tasks: readonly AssignedTask[],
  groupBy: MyWorkGroupBy,
  today: Date = new Date(),
  /** A status's word: the chosen project's column name (R2.4), or the standard one. */
  statusLabel: (status: AssignedTask['status']) => string = (status) => taskStatusLabel(status)
): MyWorkGroup[] {
  if (groupBy === 'none')
    return [{ key: 'all', label: t('views:myWork.allTasks'), tasks: [...tasks] }]
  const buckets = new Map<string, AssignedTask[]>()
  const keyOf = (task: AssignedTask): string =>
    groupBy === 'due'
      ? dueBucket(task.targetDate, today)
      : groupBy === 'project'
        ? task.projectId
        : groupBy === 'status'
          ? task.status
          : task.priority
  for (const task of tasks) {
    const key = keyOf(task)
    const list = buckets.get(key)
    if (list) list.push(task)
    else buckets.set(key, [task])
  }
  const group = (id: string, label: string, color?: string): MyWorkGroup[] => {
    const found = buckets.get(id)
    return found
      ? [{ key: `${groupBy}:${id}`, label, ...(color ? { color } : {}), tasks: found }]
      : []
  }
  switch (groupBy) {
    case 'due':
      return DUE_BUCKETS.flatMap((bucket) => group(bucket.id, bucket.label))
    case 'status':
      return TASK_STATUSES.flatMap((status) => group(status, statusLabel(status)))
    case 'priority':
      return [...TASK_PRIORITIES]
        .reverse()
        .flatMap((priority) => group(priority, taskPriorityLabel(priority)))
    case 'project': {
      const projects = new Map<string, AssignedTask>()
      for (const task of tasks)
        if (!projects.has(task.projectId)) projects.set(task.projectId, task)
      return [...projects.values()]
        .sort((a, b) => a.projectName.localeCompare(b.projectName))
        .flatMap((task) => group(task.projectId, task.projectName, task.projectColor))
    }
  }
}

export interface MyWorkComparer {
  compare: (a: AssignedTask, b: AssignedTask) => number
  /** Empty values sort last whatever the direction. */
  isEmpty?: (task: AssignedTask) => boolean
}

const STATUS_RANK = new Map(TASK_STATUSES.map((status, index) => [status, index]))
const PRIORITY_RANK = new Map(TASK_PRIORITIES.map((priority, index) => [priority, index]))

/** How each column sorts: as the List's columns do. Assignee does not sort: it is the person shown. */
export const MY_WORK_COMPARERS: Partial<Record<MyWorkColumnId, MyWorkComparer>> = {
  title: { compare: (a, b) => a.title.localeCompare(b.title) },
  project: { compare: (a, b) => a.projectName.localeCompare(b.projectName) },
  status: {
    compare: (a, b) => (STATUS_RANK.get(a.status) ?? 0) - (STATUS_RANK.get(b.status) ?? 0)
  },
  priority: {
    compare: (a, b) => (PRIORITY_RANK.get(a.priority) ?? 0) - (PRIORITY_RANK.get(b.priority) ?? 0)
  },
  due: {
    compare: (a, b) => compareIsoDates(a.targetDate!, b.targetDate!),
    isEmpty: (task) => !task.targetDate
  },
  start: {
    compare: (a, b) => compareIsoDates(a.startDate!, b.startDate!),
    isEmpty: (task) => !task.startDate
  },
  milestone: {
    compare: (a, b) => (a.milestoneName ?? '').localeCompare(b.milestoneName ?? ''),
    isEmpty: (task) => !task.milestoneName
  },
  estimate: {
    compare: (a, b) => a.estimate! - b.estimate!,
    isEmpty: (task) => task.estimate === null
  }
}
