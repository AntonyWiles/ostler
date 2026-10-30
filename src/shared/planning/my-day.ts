import type { HomeTask, MyDayTask, PlanMyDayCandidates } from '../ostler-api'
import { dailyCapacityHours } from './reschedule'

/**
 * Plan my day (N1.4, decision N12): the pure rules the panel, Home and the
 * service share. Which tasks each of the panel's sections offers, and the
 * running total of what was picked against the day's hours.
 */

/** How many high and critical tasks with no date the panel offers at most. */
export const MY_DAY_HIGH_PRIORITY_LIMIT = 8

export type PlanSectionId =
  'leftOver' | 'overdue' | 'today' | 'inProgress' | 'newToday' | 'highPriority'

export interface PlanSection {
  id: PlanSectionId
  tasks: MyDayTask[]
}

const REASON_SECTION: Record<NonNullable<HomeTask['reason']>, PlanSectionId> = {
  overdue: 'overdue',
  today: 'today',
  'in-progress': 'inProgress',
  'new-today': 'newToday'
}

/**
 * The panel's sections, in order: what was left from the last list, Today's
 * tasks by why they are in Today (the same tasks Home's Today counts), and
 * high-priority tasks with no date. A task is offered once, in the first
 * section it belongs to, and never when it is already in today's list.
 * Empty sections are left out.
 */
export function planSections(candidates: PlanMyDayCandidates): PlanSection[] {
  const seen = new Set(candidates.myDay.map((task) => task.id))
  const sections = new Map<PlanSectionId, MyDayTask[]>()
  const offer = (id: PlanSectionId, task: MyDayTask) => {
    if (seen.has(task.id)) return
    seen.add(task.id)
    sections.set(id, [...(sections.get(id) ?? []), task])
  }
  for (const task of candidates.leftOver?.tasks ?? []) offer('leftOver', task)
  for (const task of candidates.today) offer(REASON_SECTION[task.reason ?? 'in-progress'], task)
  for (const task of candidates.highPriority) offer('highPriority', task)
  const order: PlanSectionId[] = [
    'leftOver',
    'overdue',
    'today',
    'inProgress',
    'newToday',
    'highPriority'
  ]
  return order.filter((id) => sections.has(id)).map((id) => ({ id, tasks: sections.get(id)! }))
}

/** What the picked tasks add up to. */
export interface MyDayTotal {
  /** Hour estimates added up, in hour projects. */
  hours: number
  /** Tasks in hour projects with no estimate. */
  unestimated: number
  /** Tasks in points projects: counted, shown apart from the hours. */
  pointsTasks: number
  /** Points in those tasks, added up. */
  points: number
}

export function myDayTotal(
  tasks: readonly Pick<MyDayTask, 'estimate' | 'estimateUnit'>[]
): MyDayTotal {
  const total: MyDayTotal = { hours: 0, unestimated: 0, pointsTasks: 0, points: 0 }
  for (const task of tasks) {
    if (task.estimateUnit === 'points') {
      total.pointsTasks++
      total.points += task.estimate ?? 0
    } else if (task.estimate === null) total.unestimated++
    else total.hours += task.estimate
  }
  return total
}

/**
 * Today's hours: the person's daily capacity from Workload (R3.2), their
 * weekly hours over their working days, or the hours typed into the panel
 * when they have none. Null when neither is known.
 */
export function myDayHours(
  me: { weeklyCapacityHours: number | null; workingDays?: readonly number[] } | null,
  typed: number | null
): { hours: number | null; fromCapacity: boolean } {
  const daily = me ? dailyCapacityHours(me.weeklyCapacityHours, me.workingDays) : null
  if (daily !== null) return { hours: Math.round(daily * 10) / 10, fromCapacity: true }
  return { hours: typed !== null && typed > 0 ? typed : null, fromCapacity: false }
}

/** Today's automatic list on Home, without the tasks already in My day. */
export function withoutMyDay<T extends { id: string }>(
  tasks: readonly T[],
  myDay: readonly { id: string }[]
): T[] {
  if (myDay.length === 0) return [...tasks]
  const picked = new Set(myDay.map((task) => task.id))
  return tasks.filter((task) => !picked.has(task.id))
}
