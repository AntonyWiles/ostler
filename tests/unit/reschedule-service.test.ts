import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { planChanges, undoChanges } from '../../src/shared/planning/reschedule'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({
  Notification: class {
    static isSupported = () => false
  },
  BrowserWindow: class {}
}))

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { RescheduleService } = await import('../../electron/services/reschedule-service')
const { createMigratedDatabase } = await import('../helpers/database')

const human = { kind: 'human' as const }
const today = '2026-10-15'

function project(id: string, extra: Partial<WatchedProject> = {}): WatchedProject {
  return { id, name: id, color: '#3b82f6', enabled: true, ...extra } as WatchedProject
}

describe('RescheduleService (N1.3)', () => {
  const tempDir = useTempDir('ostler-reschedule-')
  let planning: InstanceType<typeof PlanningService>
  let people: InstanceType<typeof PeopleService>
  let projects: WatchedProject[]
  let meId: string
  let bobId: string

  beforeEach(async () => {
    const databasePath = await createMigratedDatabase(tempDir())
    projects = [project('p1', { estimateUnit: 'hours' }), project('p2'), project('off')]
    projects[2].enabled = false
    planning = new PlanningService(databasePath, () => projects.map((entry) => entry.id))
    people = new PeopleService(databasePath)
    meId = people.ensureMe('Jordan').id
    bobId = people.create({ name: 'Bob' }).id
  })

  afterEach(() => {
    planning.close()
    people.close()
  })

  const service = () =>
    new RescheduleService({
      planning,
      getProjects: () => projects,
      getPerson: (id) => people.list({ includeArchived: true }).find((p) => p.id === id) ?? null,
      getMe: () => people.getMe()
    })
  const add = (projectId: string, title: string, extra: object = {}) =>
    planning.createWorkItem(projectId, { title, ...extra }, human)

  it('previews the overdue tasks Today counts: Me or nobody, open, in enabled projects', () => {
    add('p1', 'Mine', { targetDate: '2026-10-01', assigneeId: meId })
    add('p2', 'Nobody', { targetDate: '2026-10-10' })
    add('p1', "Bob's", { targetDate: '2026-10-01', assigneeId: bobId })
    add('p1', 'Done', { targetDate: '2026-10-01', status: 'done' })
    add('p1', 'Not yet', { targetDate: '2026-10-20' })
    add('off', 'Disabled', { targetDate: '2026-10-01' })
    const plan = service().preview({ today, mode: 'tomorrow' })
    expect(plan.entries.map((entry) => entry.title).sort()).toEqual(['Mine', 'Nobody'])
    // Nothing changed.
    expect(planning.listWorkItems('p1').find((item) => item.title === 'Mine')?.targetDate).toBe(
      '2026-10-01'
    )
  })

  it("spreads by Me's capacity, counting work already due and each project's unit", () => {
    people.update(meId, { weeklyCapacityHours: 20 })
    // Already 3 h due tomorrow (Friday) in the hours project.
    add('p1', 'Booked', { targetDate: '2026-10-16', estimate: 3, assigneeId: meId })
    add('p1', 'Two hours', { targetDate: '2026-10-01', estimate: 2, assigneeId: meId })
    add('p2', 'Points', { targetDate: '2026-10-02', estimate: 5, assigneeId: meId })
    const plan = service().preview({ today, mode: 'spread', days: 3 })
    const due = Object.fromEntries(plan.entries.map((entry) => [entry.title, entry.toDue]))
    // 4 h a day: Two hours does not fit beside the 3 h; the points task counts 1 h.
    expect(due).toEqual({ 'Two hours': '2026-10-19', Points: '2026-10-16' })
  })

  it('previews named tasks and marks a repeating one', () => {
    const item = add('p2', 'Weekly', { targetDate: '2026-10-08' })
    planning.setRecurrence(item.id, { rule: { every: 'week', interval: 1 } }, human)
    const plan = service().preview({ today, mode: 'today', workItemIds: [item.id] })
    expect(plan.entries).toMatchObject([{ id: item.id, toDue: today, recurring: true }])
  })

  it('applies a plan in one go, skips a task changed since the preview, and undo restores', () => {
    const a = add('p1', 'A', {
      targetDate: '2026-10-01',
      startDate: '2026-09-29',
      assigneeId: meId
    })
    const b = add('p2', 'B', { targetDate: '2026-10-05' })
    const c = add('p2', 'C', { targetDate: '2026-10-06' })
    const plan = service().preview({ today, mode: 'tomorrow' })
    // C moves on its own after the preview.
    planning.updateWorkItem(c.id, { targetDate: '2026-10-30' }, human)
    const result = service().apply(planChanges(plan.entries), human)
    expect(result.changed.map((change) => change.id).sort()).toEqual([a.id, b.id].sort())
    expect(result.skipped).toEqual([{ id: c.id, title: 'C', reason: 'changed' }])
    expect(planning.getWorkItem(a.id)).toMatchObject({
      targetDate: '2026-10-16',
      startDate: '2026-10-14'
    })
    expect(planning.getWorkItem(b.id).targetDate).toBe('2026-10-16')
    expect(planning.getWorkItem(c.id).targetDate).toBe('2026-10-30')
    // Each change went through the normal update: it is in the task's activity.
    expect(planning.listActivity('p2', b.id).entries.length).toBeGreaterThan(0)

    const undone = service().apply(undoChanges(result.changed), human)
    expect(undone.skipped).toEqual([])
    expect(planning.getWorkItem(a.id)).toMatchObject({
      targetDate: '2026-10-01',
      startDate: '2026-09-29'
    })
    expect(planning.getWorkItem(b.id).targetDate).toBe('2026-10-05')
  })

  it('changes nothing when one change in the plan is refused', () => {
    const a = add('p1', 'A', { targetDate: '2026-10-01' })
    const b = add('p1', 'B', { targetDate: '2026-10-02' })
    expect(() =>
      service().apply(
        [
          { id: a.id, fromDue: '2026-10-01', toDue: '2026-10-16', fromStart: null, toStart: null },
          // A start after the due date: the planning service refuses it.
          {
            id: b.id,
            fromDue: '2026-10-02',
            toDue: '2026-10-16',
            fromStart: null,
            toStart: '2026-10-20'
          }
        ],
        human
      )
    ).toThrow()
    expect(planning.getWorkItem(a.id).targetDate).toBe('2026-10-01')
    expect(planning.getWorkItem(b.id).targetDate).toBe('2026-10-02')
  })

  it('keeps an apply to one project when asked', () => {
    const other = add('p2', 'Other', { targetDate: '2026-10-01' })
    const result = service().apply(
      [{ id: other.id, fromDue: '2026-10-01', toDue: today, fromStart: null, toStart: null }],
      human,
      'p1'
    )
    expect(result.skipped).toMatchObject([{ id: other.id, reason: 'missing' }])
    expect(planning.getWorkItem(other.id).targetDate).toBe('2026-10-01')
  })

  describe('move what waits on it (N7.1)', () => {
    // Monday 12 to Friday 16 October 2026.
    const chain = () => {
      const a = add('p1', 'A', { targetDate: '2026-10-12' })
      const b = add('p1', 'B', { targetDate: '2026-10-13', dependencyIds: [a.id] })
      const c = add('p1', 'C', { targetDate: '2026-10-14', dependencyIds: [b.id] })
      const done = add('p1', 'Done', {
        targetDate: '2026-10-13',
        dependencyIds: [a.id],
        status: 'done'
      })
      return { a, b, c, done }
    }
    const moveA = (id: string) => ({
      id,
      fromDue: '2026-10-12',
      toDue: '2026-10-14',
      fromStart: null,
      toStart: null
    })

    it("plans from the project's tasks on Me's working days, changing nothing", () => {
      const { a, b, c, done } = chain()
      people.update(meId, { workingDays: [1, 2, 3, 4, 5, 6] })
      planning.updateWorkItem(a.id, { targetDate: '2026-10-14' }, human)
      const plan = service().planDependents([moveA(a.id)])
      expect(plan.entries.map((entry) => [entry.title, entry.toDue])).toEqual([
        ['B', '2026-10-15'],
        ['C', '2026-10-16']
      ])
      expect(plan.skipped).toEqual([{ id: done.id, title: 'Done', reason: 'done' }])
      expect(planning.getWorkItem(b.id).targetDate).toBe('2026-10-13')
      expect(planning.getWorkItem(c.id).targetDate).toBe('2026-10-14')
    })

    it('applies in one transaction, undo restores all, and a changed task is skipped', () => {
      const { a, b, c } = chain()
      planning.updateWorkItem(a.id, { targetDate: '2026-10-14' }, human)
      const plan = service().planDependents([moveA(a.id)])
      // C changes after the preview: it is left as it is.
      planning.updateWorkItem(c.id, { targetDate: '2026-10-20' }, human)
      const result = service().apply(plan.entries, human)
      expect(result.changed.map((change) => change.id)).toEqual([b.id])
      expect(result.skipped).toMatchObject([{ id: c.id, reason: 'changed' }])
      expect(planning.getWorkItem(b.id).targetDate).toBe('2026-10-15')
      service().apply(undoChanges(result.changed), human)
      expect(planning.getWorkItem(b.id).targetDate).toBe('2026-10-13')
    })

    it('moves everything or nothing (moveDependents)', () => {
      const { a, b, c } = chain()
      planning.updateWorkItem(a.id, { targetDate: '2026-10-14' }, human)
      const moved = service().moveDependents([moveA(a.id)], human, 'p1')
      expect(moved.changed.map((change) => change.id)).toEqual([b.id, c.id])
      expect(moved.left).toMatchObject([{ title: 'Done', reason: 'done' }])
      expect(planning.getWorkItem(c.id).targetDate).toBe('2026-10-16')
      // Inside a transaction that fails later, nothing stays moved.
      planning.updateWorkItem(a.id, { targetDate: '2026-10-20' }, human)
      expect(() =>
        planning.runInTransaction(() => {
          service().moveDependents(
            [{ ...moveA(a.id), fromDue: '2026-10-14', toDue: '2026-10-20' }],
            human
          )
          throw new Error('later step failed')
        })
      ).toThrow('later step failed')
      expect(planning.getWorkItem(c.id).targetDate).toBe('2026-10-16')
    })

    it("refuses another project's task when kept to one project", () => {
      const other = add('p2', 'Other', { targetDate: '2026-10-12' })
      expect(() => service().planDependents([moveA(other.id)], 'p1')).toThrow(/not found/)
    })
  })
})
