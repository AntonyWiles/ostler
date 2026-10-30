import type {
  CreatePlanningWorkItemInput,
  PlanningColumnSettings,
  PlanningFieldDefinition,
  PlanningPriority,
  PlanningWorkItem,
  PlanningWorkItemStatus
} from '../ostler-api'
import { addDays, compareIsoDates, daysFromToday, toIsoDate } from '../dates'
import { TASK_PRIORITIES, TASK_STATUSES, taskColumnLabel, taskPriorityLabel } from '../task-labels'
import { columnKey, isStatusHidden, orderedColumns, taskColumnKey } from '../board-columns'
import { t } from '../i18n'
import { compareFieldValues } from './custom-fields'

/**
 * The List view's rules (P5.3): how tasks group, which due bucket a date is
 * in, and what a group's quick-add row fills in. Pure, so the view, its
 * tests and any later surface (Home, P5.6) answer the same way.
 */

/** The List's columns, in their default order: the view and the CSV export share them. */
export const LIST_COLUMN_IDS = [
  /** The task's ID, SHOP-12 (N9.8a); sorts by number. */
  'key',
  'title',
  'status',
  'priority',
  'assignee',
  'start',
  'due',
  'estimate',
  'milestone',
  /** The task's workstream (sub-project). */
  'subproject',
  'labels',
  'checklist',
  'comments',
  'updated',
  'created'
] as const

export type ListColumnId = (typeof LIST_COLUMN_IDS)[number]

/** A custom field's column (R2.2): `field:<field id>`. */
export type FieldColumnId = `field:${string}`

/** Any List column: a built-in one or a custom field's. */
export type ListColumnKey = ListColumnId | FieldColumnId

export function fieldColumnId(fieldId: string): FieldColumnId {
  return `field:${fieldId}`
}

/** The field id of a custom field's column or grouping, or null for a built-in one. */
export function fieldIdOf(key: string): string | null {
  return key.startsWith('field:') && key.length > 'field:'.length
    ? key.slice('field:'.length)
    : null
}

/** Whether a field's values can group the List and the Board's swimlanes. */
export function isGroupableField(field: Pick<PlanningFieldDefinition, 'type'>): boolean {
  return field.type === 'choice' || field.type === 'checkbox'
}

export const LIST_COLUMN_LABELS: Record<ListColumnId, string> = {
  get key() {
    return t('tasks:list.key')
  },
  get title() {
    return t('tasks:list.title')
  },
  get status() {
    return t('tasks:list.status')
  },
  get priority() {
    return t('tasks:list.priority')
  },
  get assignee() {
    return t('tasks:list.assignee')
  },
  get start() {
    return t('tasks:list.start')
  },
  get due() {
    return t('tasks:list.due')
  },
  get estimate() {
    return t('tasks:list.estimate')
  },
  get milestone() {
    return t('tasks:list.milestone')
  },
  get subproject() {
    return t('tasks:subprojects.field')
  },
  get labels() {
    return t('tasks:list.labels')
  },
  get checklist() {
    return t('tasks:list.checklist')
  },
  get comments() {
    return t('tasks:list.comments')
  },
  get updated() {
    return t('tasks:list.updated')
  },
  get created() {
    return t('tasks:list.created')
  }
}

export type ListGroupBy =
  | 'none'
  | 'status'
  | 'assignee'
  | 'milestone'
  /** The task's workstream (sub-project); offered once the project has one and the view is not scoped. */
  | 'subproject'
  | 'priority'
  | 'label'
  | 'due'
  /** The task's type (N2.7a); offered once the project has a type. */
  | 'type'
  /** A Choice or Checkbox custom field (R2.2). */
  | FieldColumnId

export const LIST_GROUP_BY: readonly { value: ListGroupBy; label: string }[] = [
  {
    value: 'none',
    get label() {
      return t('tasks:list.none')
    }
  },
  {
    value: 'status',
    get label() {
      return t('tasks:list.status')
    }
  },
  {
    value: 'assignee',
    get label() {
      return t('tasks:list.assignee')
    }
  },
  {
    value: 'milestone',
    get label() {
      return t('tasks:list.milestone')
    }
  },
  {
    value: 'subproject',
    get label() {
      return t('tasks:subprojects.field')
    }
  },
  {
    value: 'priority',
    get label() {
      return t('tasks:list.priority')
    }
  },
  {
    value: 'label',
    get label() {
      return t('tasks:list.label')
    }
  },
  {
    value: 'due',
    get label() {
      return t('tasks:list.dueDate')
    }
  },
  {
    value: 'type',
    get label() {
      return t('tasks:taskTypes.field')
    }
  }
]

export function isListGroupBy(value: unknown): value is ListGroupBy {
  return (
    LIST_GROUP_BY.some((option) => option.value === value) ||
    (typeof value === 'string' && fieldIdOf(value) !== null)
  )
}

/**
 * The List's Group by choices: the built-in ones (Type once the project has
 * a type, or while grouped by it), then the project's Choice and Checkbox fields.
 */
export function listGroupByOptions(
  fields: readonly PlanningFieldDefinition[],
  options: {
    hasTypes?: boolean
    /** The project has a workstream and the view shows the whole project. */
    hasSubprojects?: boolean
    current?: ListGroupBy
  } = {}
): { value: ListGroupBy; label: string }[] {
  return [
    ...LIST_GROUP_BY.filter(
      (option) =>
        (option.value !== 'type' || options.hasTypes || options.current === 'type') &&
        (option.value !== 'subproject' ||
          options.hasSubprojects ||
          options.current === 'subproject')
    ),
    ...fields
      .filter(isGroupableField)
      .map((field) => ({ value: fieldColumnId(field.id), label: field.name }))
  ]
}

/**
 * Tasks grouped by a Choice or Checkbox field: one group per option in the
 * field's order (or Yes), then the tasks with none. A new task added to a
 * group gets that value.
 */
export function groupByField(
  items: readonly PlanningWorkItem[],
  field: PlanningFieldDefinition
): ListGroup[] {
  const valueOf = (item: PlanningWorkItem) => item.fieldValues?.[field.id]
  if (field.type === 'checkbox')
    return [
      {
        key: `field:${field.id}:yes`,
        label: t('tasks:customFields.groupYes', { fieldName: field.name }),
        items: items.filter((item) => valueOf(item) === true),
        quickAdd: { fieldValues: { [field.id]: true } }
      },
      {
        key: `field:${field.id}:none`,
        label: t('tasks:customFields.groupNo', { fieldName: field.name }),
        items: items.filter((item) => valueOf(item) !== true),
        quickAdd: {}
      }
    ]
  const known = new Set(field.options.map((option) => option.id))
  return [
    ...field.options.map((option) => ({
      key: `field:${field.id}:${option.id}`,
      label: option.name,
      items: items.filter((item) => valueOf(item) === option.id),
      quickAdd: { fieldValues: { [field.id]: option.id } }
    })),
    {
      key: `field:${field.id}:none`,
      label: t('tasks:customFields.groupNone', { fieldName: field.name }),
      items: items.filter((item) => {
        const value = valueOf(item)
        return typeof value !== 'string' || !known.has(value)
      }),
      quickAdd: {}
    }
  ]
}

export type DueBucket = 'overdue' | 'today' | 'this-week' | 'next-week' | 'later' | 'none'

export const DUE_BUCKETS: readonly { id: DueBucket; label: string }[] = [
  {
    id: 'overdue',
    get label() {
      return t('tasks:list.overdue')
    }
  },
  {
    id: 'today',
    get label() {
      return t('tasks:list.today')
    }
  },
  {
    id: 'this-week',
    get label() {
      return t('tasks:list.week')
    }
  },
  {
    id: 'next-week',
    get label() {
      return t('tasks:list.nextWeek')
    }
  },
  {
    id: 'later',
    get label() {
      return t('tasks:list.later')
    }
  },
  {
    id: 'none',
    get label() {
      return t('tasks:list.noDate')
    }
  }
]

/**
 * Days from `today` to the last day of its week. Weeks run Monday to Sunday
 * (ISO 8601), whatever the day `today` is.
 */
function daysToWeekEnd(today: Date): number {
  return (7 - today.getDay()) % 7
}

/**
 * Which bucket a due date (`YYYY-MM-DD`) falls in, seen from `today` in
 * local time: before today, today, the rest of this week, next week, later,
 * or no date. Done work is bucketed by its date like any other.
 */
export function dueBucket(targetDate: string | null, today: Date = new Date()): DueBucket {
  if (!targetDate) return 'none'
  const days = daysFromToday(targetDate, today)
  if (days === null) return 'none'
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  const weekEnd = daysToWeekEnd(today)
  if (days <= weekEnd) return 'this-week'
  if (days <= weekEnd + 7) return 'next-week'
  return 'later'
}

/**
 * The due date a task added to a bucket gets: its first day. Null for "No
 * date"; undefined where nothing can be added (Overdue, and This week on a
 * Sunday, when no day of it is left).
 */
export function dueBucketStart(
  bucket: DueBucket,
  today: Date = new Date()
): string | null | undefined {
  const weekEnd = daysToWeekEnd(today)
  switch (bucket) {
    case 'today':
      return toIsoDate(today)
    case 'this-week':
      return weekEnd >= 1 ? toIsoDate(addDays(today, 1)) : undefined
    case 'next-week':
      return toIsoDate(addDays(today, weekEnd + 1))
    case 'later':
      return toIsoDate(addDays(today, weekEnd + 8))
    case 'none':
      return null
    default:
      return undefined
  }
}

export interface ListGroup {
  /** Stable within a grouping: `status:ready`, `assignee:none`. */
  key: string
  label: string
  items: PlanningWorkItem[]
  /**
   * What a task added at the end of this group starts with, so it lands in
   * the group. Null when this group takes no new tasks (Overdue).
   */
  quickAdd: Partial<CreatePlanningWorkItemInput> | null
}

export interface ListGroupContext {
  projectedStatus: (item: PlanningWorkItem) => PlanningWorkItemStatus
  /** Every milestone, in the project's order. */
  milestones: readonly { id: string; name: string }[]
  /** People in display order (Me first), archived ones included. */
  people: readonly { id: string; name: string; isMe: boolean }[]
  /** The project's custom fields (R2.2), for grouping by one. */
  fields?: readonly PlanningFieldDefinition[]
  /** The project's task types (N2.7a), in its order, for grouping by type. */
  taskTypes?: readonly { id: string; name: string }[]
  /** The project's workstreams (sub-projects), in order, for grouping by workstream. */
  subprojects?: readonly { id: string; name: string }[]
  /** The project's column settings (R2.4): its words, and no group for a hidden empty column. */
  columns?: PlanningColumnSettings | null
  today?: Date
}

/**
 * Tasks in groups, in a fixed order per grouping. Statuses, priorities, due
 * buckets and milestones always show every group, so there is a row to add
 * to an empty one; assignees show Me and anyone with work here, and labels
 * the ones in use. A task with several labels is grouped under its first.
 */
export function groupTasks(
  items: readonly PlanningWorkItem[],
  groupBy: ListGroupBy,
  context: ListGroupContext
): ListGroup[] {
  const today = context.today ?? new Date()
  const by = <K extends string>(keyOf: (item: PlanningWorkItem) => K) => {
    const groups = new Map<K, PlanningWorkItem[]>()
    for (const item of items) {
      const key = keyOf(item)
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    return (key: K) => groups.get(key) ?? []
  }

  const fieldId = fieldIdOf(groupBy)
  if (fieldId !== null) {
    const field = context.fields?.find((candidate) => candidate.id === fieldId)
    // A grouping by a field that is gone shows the tasks ungrouped.
    if (field && isGroupableField(field)) return groupByField(items, field)
    return [{ key: 'all', label: t('tasks:list.allTasks'), items: [...items], quickAdd: {} }]
  }
  switch (groupBy) {
    case 'none':
      return [{ key: 'all', label: t('tasks:list.allTasks'), items: [...items], quickAdd: {} }]
    case 'status': {
      // Each status, then the project's own columns counting as it (MOP-26).
      const of = by((item) => taskColumnKey(item, context.columns, context.projectedStatus(item)))
      return orderedColumns(context.columns).flatMap(({ status, custom }) => {
        const key = columnKey(status, custom?.id)
        const hidden = custom ? custom.hidden : isStatusHidden(status, context.columns)
        if (hidden && of(key).length === 0) return []
        const columnId = custom?.id ?? null
        return [
          {
            key: `status:${key}`,
            label: taskColumnLabel({ status, columnId }, context.columns),
            items: of(key),
            quickAdd: columnId ? { status, columnId } : { status }
          }
        ]
      })
    }
    case 'priority': {
      const of = by((item) => item.priority)
      return [...TASK_PRIORITIES].reverse().map((priority: PlanningPriority) => ({
        key: `priority:${priority}`,
        label: taskPriorityLabel(priority),
        items: of(priority),
        quickAdd: { priority }
      }))
    }
    case 'milestone': {
      const known = new Set(context.milestones.map((milestone) => milestone.id))
      const of = by((item) =>
        item.milestoneId && known.has(item.milestoneId) ? item.milestoneId : ''
      )
      return [
        ...context.milestones.map((milestone) => ({
          key: `milestone:${milestone.id}`,
          label: milestone.name,
          items: of(milestone.id),
          quickAdd: { milestoneId: milestone.id }
        })),
        {
          key: 'milestone:none',
          label: t('tasks:list.noMilestone'),
          items: of(''),
          quickAdd: { milestoneId: null }
        }
      ]
    }
    case 'subproject': {
      const subs = context.subprojects ?? []
      const known = new Set(subs.map((sub) => sub.id))
      const of = by((item) =>
        item.subprojectId && known.has(item.subprojectId) ? item.subprojectId : ''
      )
      return [
        ...subs.map((sub) => ({
          key: `subproject:${sub.id}`,
          label: sub.name,
          items: of(sub.id),
          quickAdd: { subprojectId: sub.id }
        })),
        {
          key: 'subproject:none',
          label: t('tasks:subprojects.noWorkstream'),
          items: of(''),
          quickAdd: { subprojectId: null }
        }
      ]
    }
    case 'assignee': {
      const known = new Set(context.people.map((person) => person.id))
      const of = by((item) =>
        item.assigneeId && known.has(item.assigneeId) ? item.assigneeId : ''
      )
      return [
        ...context.people
          .filter((person) => person.isMe || of(person.id).length > 0)
          .map((person) => ({
            key: `assignee:${person.id}`,
            label: person.isMe ? t('tasks:list.you', { personName: person.name }) : person.name,
            items: of(person.id),
            quickAdd: { assigneeId: person.id }
          })),
        {
          key: 'assignee:none',
          label: t('tasks:list.unassigned'),
          items: of(''),
          quickAdd: { assigneeId: null }
        }
      ]
    }
    case 'type': {
      const types = context.taskTypes ?? []
      const known = new Set(types.map((type) => type.id))
      const of = by((item) => (item.typeId && known.has(item.typeId) ? item.typeId : ''))
      return [
        ...types.map((type) => ({
          key: `type:${type.id}`,
          label: type.name,
          items: of(type.id),
          quickAdd: { typeId: type.id }
        })),
        {
          key: 'type:none',
          label: t('tasks:taskTypes.noType'),
          items: of(''),
          quickAdd: { typeId: null }
        }
      ]
    }
    case 'label': {
      const of = by((item) => item.labels[0] ?? '')
      const labels = [...new Set(items.flatMap((item) => item.labels.slice(0, 1)))].sort((a, b) =>
        a.localeCompare(b)
      )
      return [
        ...labels.map((label) => ({
          key: `label:${label}`,
          label,
          items: of(label),
          quickAdd: { labels: [label] }
        })),
        { key: 'label:none', label: t('tasks:list.noLabel'), items: of(''), quickAdd: {} }
      ]
    }
    default: {
      const of = by((item) => dueBucket(item.targetDate, today))
      return DUE_BUCKETS.map((bucket) => {
        const start = dueBucketStart(bucket.id, today)
        return {
          key: `due:${bucket.id}`,
          label: bucket.label,
          items: of(bucket.id),
          quickAdd: start === undefined ? null : { targetDate: start }
        }
      })
    }
  }
}

export interface ListTreeRow {
  item: PlanningWorkItem
  /** 0 for a task shown at the top level, 1 for its subtask, and so on. */
  depth: number
  /** Subtasks shown under it in this group. */
  childCount: number
}

/**
 * A group's tasks with subtasks under their parent, each level in `order`.
 * A subtask whose parent is not in the group (another group, or filtered
 * out) shows at the top level. Subtasks of a parent in `collapsed` are left
 * out.
 */
export function nestSubtasks(
  items: readonly PlanningWorkItem[],
  order: (items: PlanningWorkItem[]) => PlanningWorkItem[],
  collapsed: ReadonlySet<string> = new Set()
): ListTreeRow[] {
  const present = new Set(items.map((item) => item.id))
  const children = new Map<string, PlanningWorkItem[]>()
  const roots: PlanningWorkItem[] = []
  for (const item of items) {
    const parent = item.parentWorkItemId
    if (parent && present.has(parent) && parent !== item.id) {
      children.set(parent, [...(children.get(parent) ?? []), item])
    } else roots.push(item)
  }
  const rows: ListTreeRow[] = []
  const seen = new Set<string>()
  // Under a collapsed parent: kept out, all the way down.
  const hide = (hidden: PlanningWorkItem[]) => {
    for (const child of hidden) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      hide(children.get(child.id) ?? [])
    }
  }
  const visit = (item: PlanningWorkItem, depth: number) => {
    if (seen.has(item.id)) return
    seen.add(item.id)
    const own = children.get(item.id) ?? []
    rows.push({ item, depth, childCount: own.length })
    if (collapsed.has(item.id)) {
      hide(own)
      return
    }
    for (const child of order(own)) visit(child, depth + 1)
  }
  for (const root of order(roots)) visit(root, 0)
  // A parent loop has no root: show what is left at the top level.
  for (const item of order(items.filter((candidate) => !seen.has(candidate.id)))) visit(item, 0)
  return rows
}

/** What sorting the List's columns needs to know beyond the task itself. */
export interface ListSortContext {
  status: (item: PlanningWorkItem) => PlanningWorkItemStatus
  personName: (id: string | null) => string
  milestoneName: (id: string | null) => string
  /** A workstream's name; left out where the project's workstreams are not loaded. */
  subprojectName?: (id: string | null) => string
  commentCount: (id: string) => number
}

export interface ListComparer {
  compare: (a: PlanningWorkItem, b: PlanningWorkItem) => number
  /** Empty values sort last whatever the direction. */
  isEmpty?: (item: PlanningWorkItem) => boolean
}

const STATUS_RANK = new Map(TASK_STATUSES.map((status, index) => [status, index]))
const PRIORITY_RANK = new Map(TASK_PRIORITIES.map((priority, index) => [priority, index]))

function checklistShare(item: PlanningWorkItem): { total: number; ticked: number } {
  const total = item.acceptanceCriteria.length
  const ticked = item.acceptanceCriteria.filter((text) =>
    item.checkedCriteria.includes(text)
  ).length
  return { total, ticked }
}

/**
 * How each List column sorts: the view and its printout (P6.1) sort with
 * these, so a printed List is in the order on screen.
 */
export function listComparers(context: ListSortContext): Record<ListColumnId, ListComparer> {
  const { personName, milestoneName, commentCount } = context
  const subprojectName = context.subprojectName ?? (() => '')
  return {
    title: { compare: (a, b) => a.title.localeCompare(b.title) },
    status: {
      compare: (a, b) =>
        (STATUS_RANK.get(context.status(a)) ?? 0) - (STATUS_RANK.get(context.status(b)) ?? 0)
    },
    priority: {
      compare: (a, b) => (PRIORITY_RANK.get(a.priority) ?? 0) - (PRIORITY_RANK.get(b.priority) ?? 0)
    },
    assignee: {
      compare: (a, b) => personName(a.assigneeId).localeCompare(personName(b.assigneeId)),
      isEmpty: (item) => !personName(item.assigneeId)
    },
    start: {
      compare: (a, b) => compareIsoDates(a.startDate!, b.startDate!),
      isEmpty: (item) => !item.startDate
    },
    due: {
      compare: (a, b) => compareIsoDates(a.targetDate!, b.targetDate!),
      isEmpty: (item) => !item.targetDate
    },
    estimate: {
      compare: (a, b) => a.estimate! - b.estimate!,
      isEmpty: (item) => item.estimate === null
    },
    milestone: {
      compare: (a, b) => milestoneName(a.milestoneId).localeCompare(milestoneName(b.milestoneId)),
      isEmpty: (item) => !milestoneName(item.milestoneId)
    },
    subproject: {
      compare: (a, b) =>
        subprojectName(a.subprojectId ?? null).localeCompare(
          subprojectName(b.subprojectId ?? null)
        ),
      isEmpty: (item) => !subprojectName(item.subprojectId ?? null)
    },
    labels: {
      compare: (a, b) => a.labels[0].localeCompare(b.labels[0]),
      isEmpty: (item) => item.labels.length === 0
    },
    checklist: {
      compare: (a, b) => {
        const [x, y] = [checklistShare(a), checklistShare(b)]
        return x.ticked / x.total - y.ticked / y.total || x.total - y.total
      },
      isEmpty: (item) => item.acceptanceCriteria.length === 0
    },
    comments: {
      compare: (a, b) => commentCount(a.id) - commentCount(b.id),
      isEmpty: (item) => commentCount(item.id) === 0
    },
    key: {
      compare: (a, b) => (a.number ?? 0) - (b.number ?? 0),
      isEmpty: (item) => typeof item.number !== 'number'
    },
    updated: { compare: (a, b) => a.updatedAt - b.updatedAt },
    created: { compare: (a, b) => a.createdAt - b.createdAt }
  }
}

/** How a custom field's column sorts (R2.2): by its type, empty last. */
export function fieldComparer(field: PlanningFieldDefinition): ListComparer {
  return {
    compare: (a, b) =>
      compareFieldValues(field, a.fieldValues?.[field.id], b.fieldValues?.[field.id]),
    isEmpty: (item) => item.fieldValues?.[field.id] === undefined
  }
}
