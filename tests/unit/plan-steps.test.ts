import { describe, expect, it } from 'vitest'
import {
  PLAN_WORKLOAD_MAX_WEEKS,
  hasPeopleToPlanFor,
  isScheduledTask,
  planProgress,
  planWorkloadWeeks
} from '../../src/shared/planning/plan-steps'
import type { PlanningGoal, PlanningMilestone, PlanningWorkItem } from '../../src/shared/ostler-api'

const goal = (overrides: Partial<PlanningGoal> = {}): PlanningGoal => ({
  id: 'g1',
  projectId: 'p1',
  title: 'Goal',
  outcome: '',
  status: 'active',
  createdAt: 0,
  updatedAt: 0,
  ...overrides
})

const milestone = (overrides: Partial<PlanningMilestone> = {}): PlanningMilestone => ({
  id: 'm1',
  projectId: 'p1',
  goalId: null,
  name: 'Milestone',
  outcome: '',
  targetDate: '2026-04-01',
  successCriteria: [],
  status: 'planned',
  createdAt: 0,
  updatedAt: 0,
  ...overrides
})

const item = (overrides: Partial<PlanningWorkItem>): PlanningWorkItem => ({
  id: 'w1',
  projectId: 'p1',
  milestoneId: null,
  title: 'Task',
  description: '',
  status: 'ready',
  priority: 'medium',
  labels: [],
  acceptanceCriteria: [],
  dependencyIds: [],
  targetDate: '2026-03-01',
  startDate: null,
  assigneeId: null,
  estimate: null,
  checkedCriteria: [],
  origin: 'human',
  linkedHarnessTaskId: null,
  autoQueue: false,
  parentWorkItemId: null,
  taskCode: '',
  phaseCode: '',
  phaseName: '',
  subtaskPhaseNumber: null,
  subtaskPhaseName: '',
  verificationStatus: 'unverified',
  verifiedBy: null,
  verifiedAt: null,
  verificationNotes: '',
  createdAt: 0,
  updatedAt: 0,
  ...overrides
})

const progress = (
  input: Partial<Parameters<typeof planProgress>[0]> = {}
): ReturnType<typeof planProgress> =>
  planProgress({ goals: [], milestones: [], workItems: [], ...input })

/** A project where every step is done. */
const complete = {
  goals: [goal()],
  milestones: [milestone()],
  workItems: [item({ milestoneId: 'm1' })]
}

describe('planProgress', () => {
  it('leaves an empty project with five open steps and nothing counted', () => {
    const p = progress()
    expect(p.steps).toEqual(['goal', 'milestones', 'tasks', 'schedule', 'start'])
    expect(p.done).toEqual({
      goal: false,
      milestones: false,
      tasks: false,
      schedule: false,
      people: true,
      start: false
    })
    expect(p.firstOpenStep).toBe('goal')
    for (const count of [
      p.goalCount,
      p.milestoneCount,
      p.undatedMilestoneCount,
      p.taskCount,
      p.tasksWithoutMilestoneCount,
      p.scheduleIssueCount,
      p.unassignedTaskCount,
      p.unestimatedTaskCount,
      p.overCapacityCount
    ])
      expect(count).toBe(0)
    for (const list of [
      p.emptyMilestoneIds,
      p.unscheduledTaskIds,
      p.orderConflictTaskIds,
      p.lateForMilestoneTaskIds
    ])
      expect(list).toEqual([])
    expect(p.hasDates).toBe(false)
  })

  it('counts achieved goals but not archived ones', () => {
    expect(progress({ goals: [goal({ status: 'archived' })] }).goalCount).toBe(0)
    const achieved = progress({ goals: [goal({ status: 'achieved' })] })
    expect(achieved.goalCount).toBe(1)
    expect(achieved.done.goal).toBe(true)
  })

  it('holds milestones back for an undated milestone unless it is complete', () => {
    const undated = progress({ milestones: [milestone({ targetDate: null })] })
    expect(undated.undatedMilestoneCount).toBe(1)
    expect(undated.done.milestones).toBe(false)
    const finished = progress({ milestones: [milestone({ targetDate: null, status: 'complete' })] })
    expect(finished.undatedMilestoneCount).toBe(0)
    expect(finished.done.milestones).toBe(true)
  })

  it('does not count done, archived, deleted, someday or in-triage tasks', () => {
    const p = progress({
      workItems: [
        item({ id: 'a', status: 'done' }),
        item({ id: 'b', archivedAt: 1 }),
        item({ id: 'c', deletedAt: 1 }),
        item({ id: 'd', someday: true }),
        item({ id: 'e', inTriage: true }),
        item({ id: 'f', archivedAt: null, deletedAt: null, someday: false, inTriage: false })
      ]
    })
    expect(p.taskCount).toBe(1)
    expect(p.tasksWithoutMilestoneCount).toBe(1)
    expect(p.unassignedTaskCount).toBe(1)
    expect(p.unestimatedTaskCount).toBe(1)
  })

  it('finds milestones with no counted task in them', () => {
    const empty = progress({
      milestones: [milestone()],
      workItems: [item({ milestoneId: 'm1', status: 'done' })]
    })
    expect(empty.emptyMilestoneIds).toEqual(['m1'])
    expect(empty.done.tasks).toBe(false)
    const filled = progress({ milestones: [milestone()], workItems: [item({ milestoneId: 'm1' })] })
    expect(filled.emptyMilestoneIds).toEqual([])
    expect(filled.done.tasks).toBe(true)
    const finished = progress({
      milestones: [milestone({ status: 'complete' })],
      workItems: [item({})]
    })
    expect(finished.emptyMilestoneIds).toEqual([])
  })

  it('schedules a task by its own date or a counted, dated milestone', () => {
    const byId = (m: PlanningMilestone) => new Map([[m.id, m]])
    const undated = item({ targetDate: null, milestoneId: 'm1' })
    expect(isScheduledTask(item({}), new Map())).toBe(true)
    expect(isScheduledTask(undated, byId(milestone()))).toBe(true)
    expect(isScheduledTask(undated, byId(milestone({ targetDate: null })))).toBe(false)
    expect(isScheduledTask(undated, byId(milestone({ status: 'archived' })))).toBe(false)

    const inUndated = progress({
      milestones: [milestone({ targetDate: null })],
      workItems: [undated]
    })
    expect(inUndated.unscheduledTaskIds).toEqual(['w1'])
    const inDated = progress({ milestones: [milestone()], workItems: [undated] })
    expect(inDated.unscheduledTaskIds).toEqual([])
    const inArchived = progress({
      milestones: [milestone({ status: 'archived' })],
      workItems: [undated]
    })
    expect(inArchived.unscheduledTaskIds).toEqual(['w1'])
  })

  it('flags a task that starts before the task it waits on is due', () => {
    const a = item({ id: 'a', targetDate: '2026-03-10' })
    const b = (startDate: string) =>
      item({ id: 'b', dependencyIds: ['a'], startDate, targetDate: '2026-03-20' })
    const early = progress({ ...complete, workItems: [a, b('2026-03-05')] })
    expect(early.orderConflictTaskIds).toEqual(['b'])
    expect(early.done.schedule).toBe(false)
    const fine = progress({ ...complete, workItems: [a, b('2026-03-11')] })
    expect(fine.orderConflictTaskIds).toEqual([])
  })

  it('flags a task due after its milestone', () => {
    const late = progress({
      milestones: [milestone()],
      workItems: [item({ milestoneId: 'm1', targetDate: '2026-04-02' })]
    })
    expect(late.lateForMilestoneTaskIds).toEqual(['w1'])
    const onTime = progress({
      milestones: [milestone()],
      workItems: [item({ milestoneId: 'm1', targetDate: '2026-04-01' })]
    })
    expect(onTime.lateForMilestoneTaskIds).toEqual([])
  })

  it('counts a task with two schedule problems once', () => {
    const p = progress({
      milestones: [milestone()],
      workItems: [
        item({ id: 'a', targetDate: '2026-04-10' }),
        item({ id: 'b', milestoneId: 'm1', dependencyIds: ['a'], targetDate: '2026-04-05' })
      ]
    })
    expect(p.orderConflictTaskIds).toEqual(['b'])
    expect(p.lateForMilestoneTaskIds).toEqual(['b'])
    expect(p.scheduleIssueCount).toBe(1)
  })

  it('shows People only when given, done with nobody over capacity', () => {
    const fine = progress({ ...complete, people: { overCapacityCount: 0 } })
    expect(fine.steps).toHaveLength(6)
    expect(fine.done.people).toBe(true)
    const over = progress({ ...complete, people: { overCapacityCount: 2 } })
    expect(over.done.people).toBe(false)
    expect(over.overCapacityCount).toBe(2)
    expect(over.done.start).toBe(false)
    expect(over.firstOpenStep).toBe('people')
  })

  it('marks Start done only when every other shown step is', () => {
    const p = progress(complete)
    expect(p.done.start).toBe(true)
    expect(p.firstOpenStep).toBe('start')
    expect(p.hasDates).toBe(true)
    expect(progress({ ...complete, goals: [] }).done.start).toBe(false)
  })

  it('opens on the first step not done and never on a hidden People', () => {
    expect(progress({ goals: [goal()] }).firstOpenStep).toBe('milestones')
    const unscheduled = progress({
      ...complete,
      milestones: [milestone({ targetDate: null, status: 'complete' })],
      workItems: [item({ milestoneId: 'm1', targetDate: null })]
    })
    expect(unscheduled.steps).not.toContain('people')
    expect(unscheduled.firstOpenStep).toBe('schedule')
  })
})

describe('hasPeopleToPlanFor (D11)', () => {
  const me = { id: 'me', isMe: true, projectId: null, archivedAt: null }
  const ana = { id: 'ana', isMe: false, projectId: null, archivedAt: null }
  const check = (
    workItems: PlanningWorkItem[],
    people: { id: string; isMe: boolean; projectId: string | null; archivedAt: number | null }[]
  ) => hasPeopleToPlanFor({ projectId: 'p1', workItems, people })

  it('is false when only Me is assigned', () => {
    expect(check([item({ assigneeId: 'me' }), item({ id: 'w2' })], [me, ana])).toBe(false)
  })

  it('is true when someone else is assigned', () => {
    expect(check([item({ assigneeId: 'ana' })], [me, ana])).toBe(true)
  })

  it('is false when someone else is on a done task only', () => {
    expect(check([item({ assigneeId: 'ana', status: 'done' })], [me, ana])).toBe(false)
  })

  it("is true for the project's own person, and false once they are archived", () => {
    expect(check([], [me, { ...ana, projectId: 'p1' }])).toBe(true)
    expect(check([], [me, { ...ana, projectId: 'p2' }])).toBe(false)
    expect(check([], [me, { ...ana, projectId: 'p1', archivedAt: 1 }])).toBe(false)
  })
})

describe('planWorkloadWeeks', () => {
  // Wednesday 14 October 2026.
  const today = '2026-10-14'

  it('runs from this week through the week of the latest date', () => {
    expect(planWorkloadWeeks(today, [])).toEqual(['2026-10-12'])
    expect(
      planWorkloadWeeks(today, [
        item({ targetDate: '2026-10-20' }),
        item({ id: 'w2', startDate: '2026-11-02', targetDate: null }),
        item({ id: 'w3', targetDate: '2027-01-01', status: 'done' })
      ])
    ).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'])
  })

  it('stops at 26 weeks', () => {
    const weeks = planWorkloadWeeks(today, [item({ targetDate: '2028-01-01' })])
    expect(weeks).toHaveLength(PLAN_WORKLOAD_MAX_WEEKS)
    expect(weeks[0]).toBe('2026-10-12')
  })
})
