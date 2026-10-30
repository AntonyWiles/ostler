import type { PlanningMilestone, PlanningWorkItem, Person } from '../ostler-api'
import { compareIsoDates } from '../dates'
import { taskTimelineBar, timelineBarSpan, type TaskTimelineBar } from './timeline'
import { t } from '../i18n'

/**
 * The Timeline's rows (P5.5): tasks in groups by milestone, assignee or
 * none, each group a collapsible row, and the tasks with no dates in an
 * Unscheduled group at the bottom. Pure, so the timeline and its table
 * alternative show the same rows in the same order. Shared (N7.6), so the
 * PowerPoint export in main draws the same rows too.
 */

/** How the Timeline groups its rows. */
export type TimelineGroupBy = 'milestone' | 'assignee' | 'none'

export type TimelineRow =
  | {
      kind: 'group'
      /** `group:` and the key, unique among rows. */
      id: string
      /** What `collapsed` stores: `milestone:<id>`, `assignee:none`, `unscheduled`... */
      key: string
      label: string
      count: number
      collapsed: boolean
      /** A milestone group's milestone, whose target date shows as a diamond. */
      milestone: PlanningMilestone | null
    }
  | {
      kind: 'task'
      id: string
      item: PlanningWorkItem
      /** Null for an unscheduled task. */
      bar: TaskTimelineBar | null
    }

export const UNSCHEDULED_GROUP = 'unscheduled'

function byBar(a: PlanningWorkItem, b: PlanningWorkItem): number {
  const left = timelineBarSpan(taskTimelineBar(a)!)
  const right = timelineBarSpan(taskTimelineBar(b)!)
  return (
    compareIsoDates(left.start, right.start) ||
    compareIsoDates(left.end, right.end) ||
    a.title.localeCompare(b.title)
  )
}

function milestoneOrder(a: PlanningMilestone, b: PlanningMilestone): number {
  if (a.targetDate && b.targetDate)
    return compareIsoDates(a.targetDate, b.targetDate) || a.name.localeCompare(b.name)
  if (a.targetDate) return -1
  if (b.targetDate) return 1
  return a.name.localeCompare(b.name)
}

interface Group {
  key: string
  label: string
  items: PlanningWorkItem[]
  milestone: PlanningMilestone | null
}

export function buildTimelineRows(
  items: readonly PlanningWorkItem[],
  options: {
    groupBy: TimelineGroupBy
    collapsed: ReadonlySet<string>
    milestones: readonly PlanningMilestone[]
    people: ReadonlyMap<string, Person>
  }
): TimelineRow[] {
  const scheduled = items.filter((item) => taskTimelineBar(item) !== null).sort(byBar)
  const unscheduled = items
    .filter((item) => taskTimelineBar(item) === null)
    .sort((a, b) => a.title.localeCompare(b.title))

  const groups: Group[] = []
  if (options.groupBy === 'milestone') {
    const known = new Set(options.milestones.map((milestone) => milestone.id))
    for (const milestone of [...options.milestones].sort(milestoneOrder)) {
      const mine = scheduled.filter((item) => item.milestoneId === milestone.id)
      if (mine.length === 0 && (!milestone.targetDate || milestone.status === 'archived')) continue
      groups.push({
        key: `milestone:${milestone.id}`,
        label: milestone.name,
        items: mine,
        milestone
      })
    }
    const loose = scheduled.filter((item) => !item.milestoneId || !known.has(item.milestoneId))
    if (loose.length > 0)
      groups.push({
        key: 'milestone:none',
        label: t('views:timelineRows.noMilestone'),
        items: loose,
        milestone: null
      })
  } else if (options.groupBy === 'assignee') {
    const byPerson = new Map<string, PlanningWorkItem[]>()
    const nobody: PlanningWorkItem[] = []
    for (const item of scheduled) {
      if (item.assigneeId && options.people.has(item.assigneeId))
        byPerson.set(item.assigneeId, [...(byPerson.get(item.assigneeId) ?? []), item])
      else nobody.push(item)
    }
    const named = [...byPerson.entries()]
      .map(([id, mine]) => ({ person: options.people.get(id)!, mine }))
      .sort((a, b) => a.person.name.localeCompare(b.person.name))
    for (const { person, mine } of named)
      groups.push({
        key: `assignee:${person.id}`,
        label: person.name,
        items: mine,
        milestone: null
      })
    if (nobody.length > 0)
      groups.push({
        key: 'assignee:none',
        label: t('views:timelineRows.unassigned'),
        items: nobody,
        milestone: null
      })
  }

  const rows: TimelineRow[] = []
  const task = (item: PlanningWorkItem): TimelineRow => ({
    kind: 'task',
    id: item.id,
    item,
    bar: taskTimelineBar(item)
  })
  const pushGroup = (group: Group) => {
    const collapsed = options.collapsed.has(group.key)
    rows.push({
      kind: 'group',
      id: `group:${group.key}`,
      key: group.key,
      label: group.label,
      count: group.items.length,
      collapsed,
      milestone: group.milestone
    })
    if (!collapsed) rows.push(...group.items.map(task))
  }
  if (options.groupBy === 'none') rows.push(...scheduled.map(task))
  else groups.forEach(pushGroup)
  if (unscheduled.length > 0)
    pushGroup({
      key: UNSCHEDULED_GROUP,
      label: t('views:timelineRows.unscheduled'),
      items: unscheduled,
      milestone: null
    })
  return rows
}
