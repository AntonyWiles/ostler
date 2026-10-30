import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { updateWorkItemThroughQueue } from '../../electron/services/queue-exit'
import { createMigratedDatabase } from '../helpers/database'
import type { HarnessProjectState, PlanningWorkItem, WatchedProject } from '@shared/ostler-api'
import { useTempDir } from '../helpers/temp-dir'

const human = { kind: 'human' as const }
const project = { id: 'p1', name: 'One' } as WatchedProject

/** A harness whose queue holds one task, in `status`; held or in review when asked. */
function harnessWith(
  taskId: string,
  status: 'pending' | 'claimed' | 'completed',
  options: { hold?: boolean; inReview?: boolean } = {}
) {
  const task = { id: taskId, status, hold: options.hold ?? false, claimedBy: null }
  const state = {
    taskQueue: [task],
    reviewSessions: options.inReview ? [{ id: 's1', taskId }] : [],
    activeSessions: []
  } as unknown as HarnessProjectState
  return {
    getState: vi.fn(() => state),
    cancelTask: vi.fn(() => {
      task.status = 'cancelled' as never
      return task as never
    }),
    setTaskHold: vi.fn((_project: WatchedProject, _id: string, hold: boolean) => {
      task.hold = hold
      return task as never
    })
  }
}

describe('leaving the agent queue: one rule for every surface', () => {
  const tempDir = useTempDir('ostler-queue-exit-')
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

  const queued = (title = 'Write the importer') => {
    const item = planning.createWorkItem('p1', { title, status: 'ready' }, human)
    return planning.compareAndSetHarnessTaskId(item.id, null, 'h1')
  }
  const update = (
    item: PlanningWorkItem,
    updates: Parameters<typeof updateWorkItemThroughQueue>[4],
    harness: ReturnType<typeof harnessWith>
  ) => updateWorkItemThroughQueue(planning, harness, project, item.id, updates, human)

  it('moving a queued task to Someday takes it out of the queue, as Won’t do does', () => {
    const item = queued()
    const harness = harnessWith('h1', 'pending')
    const saved = update(item, { someday: true }, harness)
    expect(saved.someday).toBe(true)
    expect(saved.leftQueue).toBe(true)
    expect(saved.linkedHarnessTaskId).toBeNull()
    expect(harness.cancelTask).toHaveBeenCalledWith(project, 'h1', item.id)
    expect(planning.getWorkItem(item.id).linkedHarnessTaskId).toBeNull()
  })

  it('so does a show-from date that hides it now; one still to come later does not hide it', () => {
    const later = queued('Later')
    const harness = harnessWith('h1', 'pending')
    expect(update(later, { showFrom: '2026-10-07' }, harness).leftQueue).toBeUndefined()
    expect(harness.cancelTask).not.toHaveBeenCalled()
    const saved = update(planning.getWorkItem(later.id), { showFrom: '2026-10-20' }, harness)
    expect(saved.leftQueue).toBe(true)
    expect(harness.cancelTask).toHaveBeenCalledTimes(1)
  })

  it('moving a queued task out of Ready takes it out of the queue', () => {
    const item = queued()
    const harness = harnessWith('h1', 'pending')
    const saved = update(item, { status: 'backlog' }, harness)
    expect(saved).toMatchObject({ status: 'backlog', linkedHarnessTaskId: null, leftQueue: true })
    expect(harness.cancelTask).toHaveBeenCalledTimes(1)
  })

  it('Blocked holds the queue entry and Ready releases it, without leaving the queue', () => {
    const item = queued()
    const harness = harnessWith('h1', 'pending')
    const held = update(item, { status: 'blocked' }, harness)
    expect(harness.setTaskHold).toHaveBeenLastCalledWith(project, 'h1', true)
    expect(held.linkedHarnessTaskId).toBe('h1')
    expect(held.status).toBe('ready')
    update(held, { status: 'ready' }, harness)
    expect(harness.setTaskHold).toHaveBeenLastCalledWith(project, 'h1', false)
    expect(harness.cancelTask).not.toHaveBeenCalled()
  })

  it('refuses a running task with a plain reason, and changes nothing', () => {
    const item = queued()
    const harness = harnessWith('h1', 'claimed')
    expect(() => update(item, { someday: true }, harness)).toThrow(/agent is working/)
    expect(() => update(item, { status: 'backlog' }, harness)).toThrow(/agent is working/)
    expect(planning.getWorkItem(item.id)).toMatchObject({
      someday: false,
      status: 'ready',
      linkedHarnessTaskId: 'h1'
    })
    expect(harness.cancelTask).not.toHaveBeenCalled()
  })

  it('refuses work waiting for review', () => {
    const item = queued()
    const harness = harnessWith('h1', 'completed', { inReview: true })
    expect(() => update(item, { someday: true }, harness)).toThrow(/review/)
  })

  it('leaves other edits of a queued task alone', () => {
    const item = queued()
    const harness = harnessWith('h1', 'pending')
    const saved = update(item, { title: 'Write the CSV importer' }, harness)
    expect(saved).toMatchObject({ title: 'Write the CSV importer', linkedHarnessTaskId: 'h1' })
    expect(saved.leftQueue).toBeUndefined()
    expect(harness.cancelTask).not.toHaveBeenCalled()
  })

  it('a refused change cancels nothing', () => {
    const item = queued()
    const harness = harnessWith('h1', 'pending')
    expect(() => update(item, { status: 'backlog', title: '' }, harness)).toThrow()
    expect(harness.cancelTask).not.toHaveBeenCalled()
    expect(planning.getWorkItem(item.id).linkedHarnessTaskId).toBe('h1')
  })
})
