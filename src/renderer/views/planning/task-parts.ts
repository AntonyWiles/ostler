import type { PlanningWorkItem } from '@shared/ostler-api'
import { fieldHoldsValue } from '@shared/task-type-fields'
import {
  Bell,
  BookUser,
  CalendarClock,
  CalendarPlus,
  EyeOff,
  GitBranch,
  Grid2x2,
  Hourglass,
  Library,
  Link2,
  ListTree,
  Paperclip,
  Repeat,
  Scale,
  Shapes,
  SlidersHorizontal,
  Tag,
  Timer,
  Wallet,
  Waypoints,
  IterationCw,
  Milestone,
  type LucideIcon
} from '../../ui/icons'

/**
 * The task drawer's optional parts: every field and section a task can have
 * beyond the everyday ones (status, title, assignee, priority, due date,
 * description, checklist and activity, which every task shows).
 *
 * One rule decides whether a part shows (`partShown`): it shows when this
 * task holds something in it, when this project's tasks usually do, or when
 * the person adds it. Everything else waits under "Add to this task", one
 * click away. There is no setting: what shows follows what is there.
 */
export const TASK_PARTS = [
  { id: 'subtasks', group: 'plan', icon: ListTree, rank: 1 },
  { id: 'reminders', group: 'track', icon: Bell, rank: 2 },
  { id: 'repeat', group: 'track', icon: Repeat, rank: 3 },
  { id: 'labels', group: 'plan', icon: Tag, rank: 4 },
  { id: 'startDate', group: 'plan', icon: CalendarPlus, rank: 5 },
  { id: 'attachments', group: 'connect', icon: Paperclip, rank: 6 },
  { id: 'waitsOn', group: 'connect', icon: Waypoints, rank: 7 },
  { id: 'milestone', group: 'plan', icon: Milestone, rank: 8 },
  { id: 'type', group: 'plan', icon: Shapes, rank: 9 },
  { id: 'fields', group: 'plan', icon: SlidersHorizontal, rank: 10 },
  { id: 'estimate', group: 'plan', icon: Hourglass, rank: 11 },
  { id: 'time', group: 'track', icon: Timer, rank: 12 },
  { id: 'timeBlocks', group: 'track', icon: CalendarClock, rank: 13 },
  { id: 'costs', group: 'track', icon: Wallet, rank: 14 },
  { id: 'iteration', group: 'plan', icon: IterationCw, rank: 15 },
  { id: 'showFrom', group: 'plan', icon: EyeOff, rank: 16 },
  { id: 'scores', group: 'plan', icon: Grid2x2, rank: 17 },
  { id: 'links', group: 'connect', icon: Link2, rank: 18 },
  { id: 'decisions', group: 'connect', icon: Scale, rank: 19 },
  { id: 'sources', group: 'connect', icon: Library, rank: 20 },
  { id: 'contacts', group: 'connect', icon: BookUser, rank: 21 },
  { id: 'github', group: 'connect', icon: GitBranch, rank: 22 }
] as const satisfies readonly {
  id: string
  group: 'plan' | 'connect' | 'track'
  icon: LucideIcon
  /** The order "Add to this task" offers it in when the project gives no lead. */
  rank: number
}[]

export type TaskPartId = (typeof TASK_PARTS)[number]['id']
export type TaskPartGroup = (typeof TASK_PARTS)[number]['group']
export type TaskPartDefinition = (typeof TASK_PARTS)[number]

export const TASK_PART_GROUPS: readonly TaskPartGroup[] = ['plan', 'track', 'connect']

export function taskPart(id: TaskPartId): TaskPartDefinition {
  return TASK_PARTS.find((part) => part.id === id) as TaskPartDefinition
}

/**
 * Whether a task holds something in a part, for the parts the task record
 * itself carries. Parts kept elsewhere (time, costs, reminders and the like)
 * answer for themselves where they load.
 */
export function itemHoldsPart(
  item: PlanningWorkItem,
  part: TaskPartId,
  items: readonly PlanningWorkItem[] = []
): boolean {
  switch (part) {
    case 'type':
      return !!item.typeId
    case 'milestone':
      return !!item.milestoneId
    case 'iteration':
      return !!item.iterationId
    case 'startDate':
      return !!item.startDate
    case 'showFrom':
      return !!item.showFrom
    case 'estimate':
      return item.estimate != null
    case 'scores':
      return item.impact != null || item.effort != null
    case 'labels':
      return item.labels.length > 0
    case 'fields':
      return Object.values(item.fieldValues ?? {}).some(fieldHoldsValue)
    case 'waitsOn':
      return item.dependencyIds.length > 0
    case 'repeat':
      return item.recurring === true
    case 'subtasks':
      return items.some((other) => other.parentWorkItemId === item.id && !other.deletedAt)
    default:
      return false
  }
}

/**
 * How much a project uses a part: at least this share of its open tasks
 * hold something in it, and at least `MIN_TASKS` of them.
 */
export const PROJECT_USE_SHARE = 1 / 3
const MIN_TASKS = 2

/**
 * The parts this project's tasks usually hold, so every task in it shows
 * them: a project that plans by milestone shows Milestone on each task, a
 * shopping list never does. Counted over open, top-level tasks.
 */
export function partsProjectUses(items: readonly PlanningWorkItem[]): Set<TaskPartId> {
  const open = items.filter(
    (item) =>
      !item.deletedAt &&
      !item.archivedAt &&
      item.status !== 'done' &&
      item.parentWorkItemId === null
  )
  const used = new Set<TaskPartId>()
  if (open.length === 0) return used
  for (const part of TASK_PARTS) {
    const holding = open.filter((item) => itemHoldsPart(item, part.id, items)).length
    if (holding >= MIN_TASKS && holding / open.length >= PROJECT_USE_SHARE) used.add(part.id)
  }
  return used
}

/** The one rule: whether a part shows on this task. */
export function partShown(input: {
  inUse: boolean
  projectUses: boolean
  added: boolean
}): boolean {
  return input.inUse || input.projectUses || input.added
}

/** How many parts "Add to this task" offers as buttons before More. */
export const QUICK_PARTS = 4

/**
 * The parts to offer as buttons, in order: those the project uses most come
 * first (it may use them on a share of tasks too small to show them on every
 * one), then the everyday order. The rest go under More.
 */
export function quickParts(
  hidden: readonly TaskPartId[],
  items: readonly PlanningWorkItem[] = []
): { quick: TaskPartId[]; more: TaskPartId[] } {
  const open = items.filter(
    (item) => !item.deletedAt && !item.archivedAt && item.parentWorkItemId === null
  )
  const usage = new Map<TaskPartId, number>()
  for (const id of hidden) {
    usage.set(id, open.filter((item) => itemHoldsPart(item, id, items)).length)
  }
  const ordered = [...hidden].sort((a, b) => {
    const byUse = (usage.get(b) ?? 0) - (usage.get(a) ?? 0)
    return byUse !== 0 ? byUse : taskPart(a).rank - taskPart(b).rank
  })
  return { quick: ordered.slice(0, QUICK_PARTS), more: ordered.slice(QUICK_PARTS) }
}
