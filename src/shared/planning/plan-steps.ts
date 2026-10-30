/**
 * The Plan page's steps and when each counts as done: one rule for every
 * screen that shows them. The marks are advice; they never disable anything.
 * Not the milestone readiness report (`planning-readiness.ts`).
 */
import type { Person, PlanningGoal, PlanningMilestone, PlanningWorkItem } from '../ostler-api'
import { compareIsoDates, shiftIsoDate } from '../dates'
import { dependencyConflicts } from './timeline'
import { workloadWeekStart } from './workload'

export const PLAN_STEPS = ['goal', 'milestones', 'tasks', 'schedule', 'people', 'start'] as const

export type PlanStep = (typeof PLAN_STEPS)[number]

/** Neither archived nor deleted. */
function isLive(item: PlanningWorkItem): boolean {
  return item.archivedAt == null && item.deletedAt == null
}

/** A live task still to do, not put off to someday and not waiting in triage. */
export function isCountedTask(item: PlanningWorkItem): boolean {
  return isLive(item) && item.status !== 'done' && item.someday !== true && item.inTriage !== true
}

function isCountedMilestone(milestone: PlanningMilestone): boolean {
  return milestone.status !== 'archived'
}

/**
 * A task has a date when it is due on a day, or it sits in a counted
 * milestone that is. A milestone with no date does not schedule its tasks.
 */
export function isScheduledTask(
  item: PlanningWorkItem,
  milestonesById: ReadonlyMap<string, PlanningMilestone>
): boolean {
  if (item.targetDate !== null) return true
  if (item.milestoneId === null) return false
  const milestone = milestonesById.get(item.milestoneId)
  return !!milestone && isCountedMilestone(milestone) && milestone.targetDate !== null
}

/**
 * Whether the People step shows (D11): a counted task here is assigned to
 * someone other than Me, or the project has its own people. One person's own
 * project has no People step.
 */
export function hasPeopleToPlanFor(input: {
  projectId: string
  workItems: readonly PlanningWorkItem[]
  people: readonly Pick<Person, 'id' | 'isMe' | 'projectId' | 'archivedAt'>[]
}): boolean {
  const byId = new Map(input.people.map((person) => [person.id, person]))
  const assignedToOthers = input.workItems.some(
    (item) =>
      isCountedTask(item) && item.assigneeId != null && byId.get(item.assigneeId)?.isMe !== true
  )
  return (
    assignedToOthers ||
    input.people.some(
      (person) => person.projectId === input.projectId && person.archivedAt === null
    )
  )
}

/** The most weeks the People step checks for overload. */
export const PLAN_WORKLOAD_MAX_WEEKS = 26

/**
 * The plan's weeks, by their Mondays: from this week through the week holding
 * the latest start or due date among counted tasks, one to 26 weeks.
 */
export function planWorkloadWeeks(today: string, workItems: readonly PlanningWorkItem[]): string[] {
  const first = workloadWeekStart(today)
  let latest = first
  for (const item of workItems) {
    if (!isCountedTask(item)) continue
    for (const date of [item.startDate, item.targetDate]) {
      if (date && compareIsoDates(date, latest) > 0) latest = date
    }
  }
  const last = workloadWeekStart(latest)
  const weeks: string[] = []
  for (
    let week = first;
    compareIsoDates(week, last) <= 0 && weeks.length < PLAN_WORKLOAD_MAX_WEEKS;
    week = shiftIsoDate(week, 7)
  ) {
    weeks.push(week)
  }
  return weeks
}

/**
 * Given when the project has people to plan for (prompt 04b works this out);
 * left out, the People step is not shown.
 */
export interface PlanPeopleInput {
  overCapacityCount: number
}

export interface PlanProgress {
  /** The steps the page shows, in order. */
  steps: PlanStep[]
  /** Whether each step is done; a step not shown is always done. */
  done: Record<PlanStep, boolean>
  /** The first shown step before Start that is not done, or Start. */
  firstOpenStep: PlanStep
  /** Goals that are not archived. */
  goalCount: number
  /** Milestones that are not archived. */
  milestoneCount: number
  /** Counted milestones, not complete, with no date. */
  undatedMilestoneCount: number
  /** Counted milestones, not complete, with no counted task in them. */
  emptyMilestoneIds: string[]
  /** Counted tasks. */
  taskCount: number
  /** Counted tasks in no milestone. */
  tasksWithoutMilestoneCount: number
  /** Counted tasks with no date of their own or from their milestone. */
  unscheduledTaskIds: string[]
  /** Counted tasks that start (or are due) before a task they wait on allows. */
  orderConflictTaskIds: string[]
  /** Counted tasks due after their milestone is. */
  lateForMilestoneTaskIds: string[]
  /** Distinct tasks across the three lists above. */
  scheduleIssueCount: number
  /** Counted tasks with nobody on them. */
  unassignedTaskCount: number
  /** Counted tasks with no estimate. */
  unestimatedTaskCount: number
  /** Whether any counted task or milestone has a date. */
  hasDates: boolean
  /** People given more than they can do; 0 when People is not shown. */
  overCapacityCount: number
}

/** How far a project's plan has got, step by step. */
export function planProgress(input: {
  goals: readonly PlanningGoal[]
  milestones: readonly PlanningMilestone[]
  workItems: readonly PlanningWorkItem[]
  people?: PlanPeopleInput | null
}): PlanProgress {
  const milestones = input.milestones.filter(isCountedMilestone)
  const milestonesById = new Map(milestones.map((milestone) => [milestone.id, milestone]))
  const tasks = input.workItems.filter(isCountedTask)
  const openMilestones = milestones.filter((milestone) => milestone.status !== 'complete')
  const usedMilestoneIds = new Set(tasks.map((task) => task.milestoneId))

  const conflicting = new Set(
    dependencyConflicts(input.workItems.filter(isLive)).map((conflict) => conflict.taskId)
  )
  const unscheduledTaskIds = tasks
    .filter((task) => !isScheduledTask(task, milestonesById))
    .map((task) => task.id)
  const orderConflictTaskIds = tasks.filter((task) => conflicting.has(task.id)).map((t) => t.id)
  const lateForMilestoneTaskIds = tasks
    .filter((task) => {
      const due = milestonesById.get(task.milestoneId ?? '')?.targetDate
      return task.targetDate !== null && !!due && compareIsoDates(task.targetDate, due) > 0
    })
    .map((task) => task.id)

  const goalCount = input.goals.filter((goal) => goal.status !== 'archived').length
  const undatedMilestoneCount = openMilestones.filter((m) => m.targetDate === null).length
  const emptyMilestoneIds = openMilestones
    .filter((milestone) => !usedMilestoneIds.has(milestone.id))
    .map((milestone) => milestone.id)
  const scheduleIssueCount = new Set([
    ...unscheduledTaskIds,
    ...orderConflictTaskIds,
    ...lateForMilestoneTaskIds
  ]).size
  const overCapacityCount = input.people ? input.people.overCapacityCount : 0
  const showPeople = input.people != null
  const steps: PlanStep[] = PLAN_STEPS.filter((step) => showPeople || step !== 'people')

  const done: Record<PlanStep, boolean> = {
    goal: goalCount >= 1,
    milestones: milestones.length >= 1 && undatedMilestoneCount === 0,
    tasks: tasks.length >= 1 && emptyMilestoneIds.length === 0,
    schedule: tasks.length >= 1 && scheduleIssueCount === 0,
    people: !showPeople || overCapacityCount === 0,
    start: false
  }
  done.start = steps.every((step) => step === 'start' || done[step])

  return {
    steps,
    done,
    firstOpenStep: steps.find((step) => step !== 'start' && !done[step]) ?? 'start',
    goalCount,
    milestoneCount: milestones.length,
    undatedMilestoneCount,
    emptyMilestoneIds,
    taskCount: tasks.length,
    tasksWithoutMilestoneCount: tasks.filter((task) => task.milestoneId === null).length,
    unscheduledTaskIds,
    orderConflictTaskIds,
    lateForMilestoneTaskIds,
    scheduleIssueCount,
    unassignedTaskCount: tasks.filter((task) => task.assigneeId === null).length,
    unestimatedTaskCount: tasks.filter((task) => task.estimate === null).length,
    hasDates:
      tasks.some((task) => task.startDate !== null || task.targetDate !== null) ||
      milestones.some((milestone) => milestone.targetDate !== null),
    overCapacityCount
  }
}
