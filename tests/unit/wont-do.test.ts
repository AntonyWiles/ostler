import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { closeAsWontDo, wontDoOptions } from '../../electron/services/planning-deletion'
import { buildProjectReport } from '../../electron/services/report-builder'
import { createMigratedDatabase } from '../helpers/database'
import { matchesFilter, parseTaskFilter, type FilterableTask } from '../../src/shared/task-filter'
import type { HarnessProjectState, PlanningWorkItem, WatchedProject } from '@shared/ostler-api'
import { useTempDir } from '../helpers/temp-dir'

const human = { kind: 'human' as const }
const project = { id: 'p1', name: 'One' } as WatchedProject

/** A harness whose queue holds one task for `item`, in `status`; in review when asked. */
function harnessWith(
  taskId: string,
  status: 'pending' | 'claimed' | 'completed',
  inReview = false
) {
  const state = {
    taskQueue: [{ id: taskId, status }],
    reviewSessions: inReview ? [{ id: 's1', taskId }] : [],
    activeSessions: []
  } as unknown as HarnessProjectState
  return {
    getState: vi.fn(() => state),
    cancelTask: vi.fn()
  }
}

describe('Won’t do (N1.2)', () => {
  const tempDir = useTempDir('ostler-wont-do-')
  let planning: PlanningService

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 7, 10, 0))
    planning = new PlanningService(await createMigratedDatabase(tempDir()), () => ['p1'])
  })

  afterEach(() => {
    planning.close()
    vi.useRealTimers()
  })

  const create = (title: string, extra: Record<string, unknown> = {}) =>
    planning.createWorkItem('p1', { title, ...extra }, human)
  const link = (item: PlanningWorkItem, taskId: string) =>
    planning.compareAndSetHarnessTaskId(item.id, null, taskId)
  const close = (
    item: PlanningWorkItem,
    options: Parameters<typeof closeAsWontDo>[5] = {},
    harness?: ReturnType<typeof harnessWith>
  ) => closeAsWontDo(planning, harness, project, item.id, human, options)

  it('closes a task: archived, its status kept, the reason and one activity entry', () => {
    const task = create('Rewrite the site', { status: 'active' })
    const result = close(task, { reason: '  No longer needed ' })

    expect(result.closedIds).toEqual([task.id])
    expect(result.workItem).toMatchObject({
      status: 'active',
      resolution: 'wont-do',
      resolutionReason: 'No longer needed'
    })
    expect(result.workItem.archivedAt).not.toBeNull()
    expect(planning.listWorkItems('p1')).toHaveLength(0)
    expect(planning.listWorkItems('p1', 'archived').map((item) => item.id)).toEqual([task.id])
    const entries = planning.listActivity('p1', task.id).entries
    const closing = entries.filter((entry) => entry.field === 'wontDo')
    expect(closing).toHaveLength(1)
    expect(closing[0].summary).toContain('No longer needed')
    // Not a status change: rules see none.
    expect(planning.listStatusTransitions(task.id).map((event) => event.to)).toEqual(['active'])
  })

  it('refuses a done task, one already closed, and a reason that is too long', () => {
    const done = create('Shipped', { status: 'done' })
    expect(() => close(done)).toThrow(/done/i)
    const open = create('Open')
    close(open)
    expect(() => close(planning.getWorkItem(open.id))).toThrow(/already/i)
    const other = create('Other')
    expect(() => close(other, { reason: 'x'.repeat(501) })).toThrow(/500/)
    expect(planning.getWorkItem(other.id).resolution).toBeNull()
  })

  it('refuses running work and work in review, in archiving’s words', () => {
    const running = create('Running', { status: 'ready' })
    link(running, 'h1')
    expect(() => close(running, { cancelQueuedWork: true }, harnessWith('h1', 'claimed'))).toThrow(
      /cannot be archived/
    )
    const review = create('Review', { status: 'ready' })
    link(review, 'h2')
    expect(() =>
      close(review, { cancelQueuedWork: true }, harnessWith('h2', 'completed', true))
    ).toThrow(/review/)
    expect(planning.getWorkItem(running.id).resolution).toBeNull()
    expect(planning.getWorkItem(review.id).resolution).toBeNull()
  })

  it('cancels queued work only when asked, then clears its link', () => {
    const queued = create('Queued', { status: 'ready' })
    link(queued, 'h3')
    const refused = harnessWith('h3', 'pending')
    expect(() => close(queued, {}, refused)).toThrow(/cannot be archived/)
    expect(refused.cancelTask).not.toHaveBeenCalled()

    const harness = harnessWith('h3', 'pending')
    const result = close(queued, { cancelQueuedWork: true }, harness)
    expect(harness.cancelTask).toHaveBeenCalledWith(project, 'h3', queued.id)
    expect(result.cancelledTask).toBe(true)
    expect(result.workItem.linkedHarnessTaskId).toBeNull()
    expect(result.workItem.resolution).toBe('wont-do')
  })

  it('closes its open subtasks only with includeSubtasks, with the same reason', () => {
    const parent = create('Parent')
    const child = create('Child', { parentWorkItemId: parent.id })
    const finished = create('Finished child', { parentWorkItemId: parent.id, status: 'done' })

    const alone = close(parent, { reason: 'Dropped' })
    expect(alone.closedIds).toEqual([parent.id])
    expect(planning.getWorkItem(child.id).resolution).toBeNull()

    planning.unarchiveWorkItem(parent.id, human)
    const all = close(planning.getWorkItem(parent.id), { reason: 'Dropped', includeSubtasks: true })
    expect(all.closedIds).toEqual([parent.id, child.id])
    expect(planning.getWorkItem(child.id)).toMatchObject({
      resolution: 'wont-do',
      resolutionReason: 'Dropped'
    })
    expect(planning.getWorkItem(finished.id).resolution).toBeNull()
  })

  it('makes a repeating task’s next occurrence, as reaching Done does', () => {
    const task = create('Water plants', { targetDate: '2026-10-07', status: 'ready' })
    planning.setRecurrence(task.id, { rule: { every: 'week', interval: 1 } }, human)

    const result = close(task, { reason: 'Away this week' })

    expect(result.repeatedAs).toBeDefined()
    const next = planning.getWorkItem(result.repeatedAs!)
    expect(next).toMatchObject({
      title: 'Water plants',
      targetDate: '2026-10-14',
      status: 'backlog'
    })
    expect(planning.getRecurrence(next.id)?.rule).toEqual({ every: 'week', interval: 1 })
    expect(planning.getRecurrence(task.id)).toBeNull()
  })

  it('reopens through unarchive: the resolution goes, the status stays, and activity records it', () => {
    const task = create('Maybe later', { status: 'blocked' })
    close(task, { reason: 'Not now' })

    const reopened = planning.unarchiveWorkItem(task.id, human)

    expect(reopened).toMatchObject({
      status: 'blocked',
      resolution: null,
      resolutionReason: '',
      archivedAt: null
    })
    const fields = planning.listActivity('p1', task.id).entries.map((entry) => entry.field)
    expect(fields).toContain('wontDo')
    expect(fields).toContain('reopened')
  })

  it('leaves a won’t-do task out of every report count, as if it had never been planned', () => {
    const milestone = planning.createMilestone('p1', { name: 'Launch' })
    const done = create('Done one', { milestoneId: milestone.id, status: 'active', estimate: 2 })
    vi.setSystemTime(new Date(2026, 9, 8, 10, 0))
    planning.updateWorkItem(done.id, { status: 'done' }, human)
    const dropped = create('Dropped one', {
      milestoneId: milestone.id,
      status: 'active',
      estimate: 5
    })
    close(dropped, { reason: 'Out of scope' })
    vi.setSystemTime(new Date(2026, 9, 9, 10, 0))

    const items = planning.listKeptWorkItemsForReports('p1')
    const history = planning.listProjectStatusTransitions('p1')
    expect(items.map((item) => item.id)).toEqual([done.id])
    expect(history.every((event) => event.workItemId === done.id)).toBe(true)

    const report = buildProjectReport({
      projectId: 'p1',
      range: '30d',
      items,
      history,
      milestones: planning.listMilestones('p1'),
      people: [],
      estimateUnit: 'points',
      now: Date.now()
    })
    const burnUp = report.burnUp.find((entry) => entry.milestoneId === milestone.id)!
    const last = burnUp.points[burnUp.points.length - 1]
    expect(last).toMatchObject({ scopeCount: 1, doneCount: 1, scopeEstimate: 2, doneEstimate: 2 })
    expect(report.throughput.weeks.reduce((sum, week) => sum + week.count, 0)).toBe(1)
    const flow = report.cumulativeFlow.points[report.cumulativeFlow.points.length - 1].counts
    expect(Object.values(flow).reduce((sum, count) => sum + count, 0)).toBe(1)
    expect(report.keyNumbers.open).toBe(0)
    expect(JSON.stringify(report)).not.toContain(dropped.id)

    expect(planning.getMilestoneMetrics(milestone.id)).toMatchObject({
      itemCount: 1,
      completedCount: 1
    })
  })

  it('reads its options strictly from an untrusted caller', () => {
    expect(wontDoOptions(undefined)).toEqual({})
    expect(wontDoOptions({ reason: 'x', includeSubtasks: true })).toEqual({
      reason: 'x',
      includeSubtasks: true,
      cancelQueuedWork: false
    })
    expect(() => wontDoOptions({ reason: 3 })).toThrow(/reason/)
    expect(() => wontDoOptions({ cancelQueuedWork: 'yes' })).toThrow(/cancelQueuedWork/)
  })
})

describe('the Resolution filter (N1.2)', () => {
  const base = {
    id: 't',
    title: 'T',
    description: '',
    status: 'active',
    priority: 'medium',
    labels: [],
    acceptanceCriteria: [],
    checkedCriteria: [],
    milestoneId: null,
    targetDate: null,
    startDate: null,
    assigneeId: null,
    estimate: null,
    createdAt: 0,
    updatedAt: 0,
    iterationId: null
  } satisfies FilterableTask
  const ctx = { today: '2026-10-07', meId: null }
  const wontDo = { ...base, resolution: 'wont-do' as const }
  const finished = { ...base, status: 'done' as const, resolution: null }

  it('is and is not won’t do', () => {
    const is = parseTaskFilter({
      conditions: [{ field: 'resolution', op: 'is', value: 'wont-do' }]
    })
    const isNot = parseTaskFilter({
      conditions: [{ field: 'resolution', op: 'isNot', value: 'wont-do' }]
    })
    expect(matchesFilter(wontDo, is, ctx)).toBe(true)
    expect(matchesFilter(finished, is, ctx)).toBe(false)
    expect(matchesFilter(wontDo, isNot, ctx)).toBe(false)
    expect(matchesFilter(finished, isNot, ctx)).toBe(true)
  })

  it('refuses a resolution it does not know', () => {
    expect(() =>
      parseTaskFilter({ conditions: [{ field: 'resolution', op: 'is', value: 'obsolete' }] })
    ).toThrow(/wont-do/)
  })
})
