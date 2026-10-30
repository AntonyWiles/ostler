import type { PlanningDependencyType, PlanningMilestone, PlanningWorkItem } from '../ostler-api'
import { dependencyLinksOf } from './dependency-links'
import { compareIsoDates, isIsoDate, isoDaysBetween, shiftIsoDate } from '../dates'
import { taskTimelineBar, timelineBarSpan } from './timeline'

/**
 * Show critical path (N7.3, decision N51): which tasks set the project's end,
 * or a milestone's date, and how far every other task can slip. Worked out
 * from the dates as they are set and the waits-on links; this is not a
 * scheduler. The Timeline and the automation API's `GET /critical-path` both
 * call `criticalPath`, so they give the same answer.
 *
 * The link rule is the Timeline's (`dependencyLinkConflict`), with each
 * link's type and lag (N7.2a): finish to start, a task may start on the day
 * what it waits on is due plus the lag; start to start, on its first day plus
 * the lag; finish to finish, be due on its due date plus the lag. A
 * task's span is `taskTimelineBar`'s: start to due, a due date alone is one
 * day, a start date alone is one day on its start. Slack is in calendar days.
 */

export type CriticalPathTaskInput = Pick<
  PlanningWorkItem,
  'id' | 'status' | 'milestoneId' | 'dependencyIds' | 'dependencyLinks' | 'startDate' | 'targetDate'
>

/** One open, dated task counted towards the end. */
export interface CriticalPathTask {
  taskId: string
  /** Its first and last day. */
  start: string
  end: string
  /** The latest it can end without pushing the end. */
  latestEnd: string
  /** Calendar days it can slip; negative when it is already late against the end. */
  slackDays: number
  /** No slack (zero or less): it sets the end. */
  critical: boolean
}

export interface CriticalPath {
  /** The milestone it is for, or null for the project's end. */
  milestoneId: string | null
  /**
   * The date everything is measured against, or null when no open task in
   * scope has a date. `endFrom` says where it came from: the milestone's
   * date, or the latest due date among the tasks.
   */
  end: string | null
  endFrom: 'milestone' | 'tasks'
  /** The critical tasks as chains, each from first to last (ties give a few). */
  chains: string[][]
  /** True when more chains tie than `MAX_CRITICAL_CHAINS` and the rest were left out. */
  moreChains: boolean
  /** Every open dated task in scope, in the order given. */
  tasks: CriticalPathTask[]
  /** Open tasks in scope with no dates: not counted. */
  undatedTaskIds: string[]
}

export const MAX_CRITICAL_CHAINS = 10

/**
 * The critical path of `tasks` (one project's, with their statuses as shown).
 * For a milestone, the scope is its tasks and everything they wait on,
 * however far back; the end is its date, or its latest task's due date when
 * it has none. Done tasks are fixed: never critical, never counted. A cycle
 * cannot be made, but each task is visited once, so one would not loop.
 */
export function criticalPath(
  tasks: readonly CriticalPathTaskInput[],
  milestone: Pick<PlanningMilestone, 'id' | 'targetDate'> | null = null
): CriticalPath {
  const byId = new Map(tasks.map((task) => [task.id, task]))

  // The tasks in scope: all of them, or the milestone's and what they wait on.
  let scope: CriticalPathTaskInput[]
  if (!milestone) scope = [...tasks]
  else {
    const seen = new Set<string>()
    const queue = tasks.filter((task) => task.milestoneId === milestone.id)
    for (const task of queue) seen.add(task.id)
    for (let index = 0; index < queue.length; index++) {
      for (const dependencyId of queue[index].dependencyIds) {
        const dependency = byId.get(dependencyId)
        if (!dependency || seen.has(dependencyId)) continue
        seen.add(dependencyId)
        queue.push(dependency)
      }
    }
    scope = tasks.filter((task) => seen.has(task.id))
  }

  const dated = new Map<string, { start: string; end: string }>()
  const undatedTaskIds: string[] = []
  for (const task of scope) {
    if (task.status === 'done') continue
    const bar = taskTimelineBar(task)
    if (bar) dated.set(task.id, timelineBarSpan(bar))
    else undatedTaskIds.push(task.id)
  }

  let end: string | null = null
  let endFrom: CriticalPath['endFrom'] = 'tasks'
  if (milestone?.targetDate && isIsoDate(milestone.targetDate)) {
    end = milestone.targetDate
    endFrom = 'milestone'
  } else {
    for (const task of scope) {
      if (milestone && task.milestoneId !== milestone.id) continue
      const span = dated.get(task.id)
      if (span && (end === null || compareIsoDates(span.end, end) > 0)) end = span.end
    }
  }
  const empty: CriticalPath = {
    milestoneId: milestone?.id ?? null,
    end,
    endFrom,
    chains: [],
    moreChains: false,
    tasks: [],
    undatedTaskIds
  }
  if (end === null) return empty

  // What waits on each dated task, among the dated ones, and how.
  const waiting = new Map<string, string[]>()
  const links = new Map<string, { type: PlanningDependencyType; lagDays: number }>()
  const linkKey = (from: string, to: string) => `${from}>${to}`
  for (const task of scope) {
    if (!dated.has(task.id)) continue
    for (const link of dependencyLinksOf(task)) {
      if (link.id === task.id || !dated.has(link.id) || links.has(linkKey(link.id, task.id)))
        continue
      links.set(linkKey(link.id, task.id), link)
      waiting.set(link.id, [...(waiting.get(link.id) ?? []), task.id])
    }
  }

  // Backward pass, as day numbers from the end. A task must end by the end,
  // and by the latest start of everything that waits on it.
  const day = (date: string) => isoDaysBetween(end!, date)
  const latestEnd = new Map<string, number>()
  const visiting = new Set<string>()
  const lengthOf = (id: string) => {
    const span = dated.get(id)!
    return isoDaysBetween(span.start, span.end)
  }
  const latestStartOf = (id: string) => latestEnd.get(id)! - lengthOf(id)
  // The latest `id` can end and keep its link to `child`, which waits on it.
  const latestEndFor = (id: string, child: string) => {
    const link = links.get(linkKey(id, child))!
    if (link.type === 'finish-to-finish') return latestEnd.get(child)! - link.lagDays
    if (link.type === 'start-to-start') return latestStartOf(child) - link.lagDays + lengthOf(id)
    return latestStartOf(child) - link.lagDays
  }
  const visit = (root: string) => {
    // Depth first without recursion, so a long chain cannot overflow the stack.
    const stack: Array<{ id: string; next: number }> = [{ id: root, next: 0 }]
    visiting.add(root)
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const after = waiting.get(frame.id) ?? []
      if (frame.next < after.length) {
        const child = after[frame.next++]
        // A task already being worked out is a cycle: that link is left out.
        if (latestEnd.has(child) || visiting.has(child)) continue
        visiting.add(child)
        stack.push({ id: child, next: 0 })
        continue
      }
      let latest = 0
      for (const child of after)
        if (latestEnd.has(child)) latest = Math.min(latest, latestEndFor(frame.id, child))
      latestEnd.set(frame.id, latest)
      visiting.delete(frame.id)
      stack.pop()
    }
  }
  for (const id of dated.keys()) if (!latestEnd.has(id)) visit(id)

  const result: CriticalPathTask[] = []
  const critical = new Set<string>()
  for (const [taskId, span] of dated) {
    const latest = latestEnd.get(taskId)!
    const slackDays = latest - day(span.end)
    if (slackDays <= 0) critical.add(taskId)
    result.push({
      taskId,
      start: span.start,
      end: span.end,
      latestEnd: shiftIsoDate(end, latest),
      slackDays,
      critical: slackDays <= 0
    })
  }

  // Chains: critical tasks joined by links that set the earlier one's latest end.
  const next = new Map<string, string[]>()
  const hasPrevious = new Set<string>()
  for (const id of critical) {
    for (const child of waiting.get(id) ?? []) {
      if (!critical.has(child) || !latestEnd.has(child)) continue
      if (latestEndFor(id, child) !== latestEnd.get(id)) continue
      next.set(id, [...(next.get(id) ?? []), child])
      hasPrevious.add(child)
    }
  }
  const byStart = (a: string, b: string) =>
    compareIsoDates(dated.get(a)!.start, dated.get(b)!.start) ||
    compareIsoDates(dated.get(a)!.end, dated.get(b)!.end)
  const chains: string[][] = []
  let moreChains = false
  const walk = (path: string[]) => {
    if (moreChains) return
    const last = path[path.length - 1]
    const children = (next.get(last) ?? []).filter((child) => !path.includes(child)).sort(byStart)
    if (children.length === 0) {
      if (chains.length === MAX_CRITICAL_CHAINS) moreChains = true
      else chains.push(path)
      return
    }
    for (const child of children) walk([...path, child])
  }
  for (const root of [...critical].filter((id) => !hasPrevious.has(id)).sort(byStart)) walk([root])

  return { ...empty, chains, moreChains, tasks: result }
}
