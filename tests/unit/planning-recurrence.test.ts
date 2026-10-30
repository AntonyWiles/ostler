import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const human = { kind: 'human' as const }

describe('recurring tasks (P5.6)', () => {
  const tempDir = useTempDir('ostler-recurrence-')
  let planning: PlanningService
  let people: PeopleService

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // Wednesday 7 October 2026, mid-morning.
    vi.setSystemTime(new Date(2026, 9, 7, 10, 0))
    const databasePath = await createMigratedDatabase(tempDir())
    planning = new PlanningService(databasePath, () => ['p1'])
    people = new PeopleService(databasePath)
  })

  afterEach(() => {
    planning.close()
    people.close()
    vi.useRealTimers()
  })

  const liveTitles = () => planning.listWorkItems('p1').map((item) => item.title)

  it('completing a weekly task twice makes exactly two further occurrences, on the right dates', () => {
    const first = planning.createWorkItem(
      'p1',
      { title: 'Water plants', targetDate: '2026-10-07', status: 'ready' },
      human
    )
    planning.setRecurrence(first.id, { rule: { every: 'week', interval: 1 } }, human)

    const done1 = planning.updateWorkItem(first.id, { status: 'done' }, human)
    expect(done1.repeatedAs).toBeDefined()
    const second = planning.getWorkItem(done1.repeatedAs!)
    expect(second).toMatchObject({
      title: 'Water plants',
      targetDate: '2026-10-14',
      status: 'backlog'
    })
    expect(planning.getRecurrence(first.id)).toBeNull()
    expect(planning.getRecurrence(second.id)?.rule).toEqual({ every: 'week', interval: 1 })

    vi.setSystemTime(new Date(2026, 9, 14, 10, 0))
    const done2 = planning.updateWorkItem(second.id, { status: 'done' }, human)
    const third = planning.getWorkItem(done2.repeatedAs!)
    expect(third.targetDate).toBe('2026-10-21')

    const items = planning.listWorkItems('p1')
    expect(items).toHaveLength(3)
    expect(items.filter((item) => item.status !== 'done').map((item) => item.id)).toEqual([
      third.id
    ])
  })

  it('makes the next occurrence only once through Done, Ready, Done', () => {
    const task = planning.createWorkItem('p1', { title: 'Report', targetDate: '2026-10-07' }, human)
    planning.setRecurrence(task.id, { rule: { every: 'day', interval: 1 } }, human)
    planning.updateWorkItem(task.id, { status: 'done' }, human)
    planning.updateWorkItem(task.id, { status: 'ready' }, human)
    const again = planning.updateWorkItem(task.id, { status: 'done' }, human)
    expect(again.repeatedAs).toBeUndefined()
    expect(liveTitles()).toEqual(['Report', 'Report'])
  })

  it('copies what belongs to the work and leaves the rest', () => {
    const ada = people.create({ name: 'Ada' })
    const milestone = planning.createMilestone('p1', { name: 'Q4' })
    const finished = planning.createMilestone('p1', { name: 'Q3' })
    planning.updateMilestone(finished.id, { status: 'complete' })
    const other = planning.createWorkItem('p1', { title: 'Other' }, human)
    const task = planning.createWorkItem(
      'p1',
      {
        title: 'Invoice run',
        description: 'Send them',
        priority: 'high',
        labels: ['admin'],
        acceptanceCriteria: ['Sent', 'Filed'],
        assigneeId: ada.id,
        estimate: 2,
        milestoneId: milestone.id,
        dependencyIds: [other.id],
        startDate: '2026-10-05',
        targetDate: '2026-10-07'
      },
      human
    )
    planning.setChecklistItemChecked(task.id, 'Sent', true, human)
    planning.setRecurrence(task.id, { rule: { every: 'month', interval: 1, monthDay: 7 } }, human)
    const next = planning.getWorkItem(
      planning.updateWorkItem(task.id, { status: 'done' }, human).repeatedAs!
    )
    expect(next).toMatchObject({
      title: 'Invoice run',
      description: 'Send them',
      priority: 'high',
      labels: ['admin'],
      acceptanceCriteria: ['Sent', 'Filed'],
      checkedCriteria: [],
      assigneeId: ada.id,
      estimate: 2,
      milestoneId: milestone.id,
      dependencyIds: [],
      targetDate: '2026-11-07',
      // The start date moves with the due date.
      startDate: '2026-11-05',
      linkedHarnessTaskId: null
    })

    // A complete milestone is not carried over.
    const late = planning.createWorkItem(
      'p1',
      { title: 'Retro', milestoneId: finished.id, targetDate: '2026-10-07' },
      human
    )
    planning.setRecurrence(late.id, { rule: { every: 'day', interval: 1 } }, human)
    const nextLate = planning.getWorkItem(
      planning.updateWorkItem(late.id, { status: 'done' }, human).repeatedAs!
    )
    expect(nextLate.milestoneId).toBeNull()
  })

  it('catches up when finished late and records "Repeated as" on both tasks', () => {
    const task = planning.createWorkItem('p1', { title: 'Backup', targetDate: '2026-09-02' }, human)
    planning.setRecurrence(task.id, { rule: { every: 'week', interval: 1 } }, human)
    const next = planning.getWorkItem(
      planning.updateWorkItem(task.id, { status: 'done' }, human).repeatedAs!
    )
    // Wednesdays from 2 Sep; today is Wednesday 7 Oct.
    expect(next.targetDate).toBe('2026-10-07')
    for (const id of [task.id, next.id]) {
      const summaries = planning.listActivity('p1', id).entries.map((entry) => entry.summary)
      expect(summaries.some((summary) => summary.startsWith('Repeated as “Backup”'))).toBe(true)
    }
  })

  it('stops after N times and drops the rule', () => {
    const task = planning.createWorkItem('p1', { title: 'Pill', targetDate: '2026-10-07' }, human)
    planning.setRecurrence(task.id, { rule: { every: 'day', interval: 1 }, remaining: 1 }, human)
    const second = planning.updateWorkItem(task.id, { status: 'done' }, human).repeatedAs!
    expect(planning.getRecurrence(second)?.remaining).toBe(0)
    expect(planning.updateWorkItem(second, { status: 'done' }, human).repeatedAs).toBeUndefined()
    expect(planning.getRecurrence(second)).toBeNull()
  })

  it('keeps the status change and leaves nothing half-made when the next task fails', () => {
    const task = planning.createWorkItem(
      'p1',
      { title: 'Payroll', targetDate: '2026-10-07' },
      human
    )
    planning.setRecurrence(task.id, { rule: { every: 'week', interval: 1 } }, human)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const spy = vi
      .spyOn(planning, 'createWorkItem')
      .mockImplementationOnce((projectId, input, actor) => {
        // Write something, then fail, as a half-finished create would.
        spy.mockRestore()
        planning.createWorkItem(projectId, input, actor)
        throw new Error('disk full')
      })
    const done = planning.updateWorkItem(task.id, { status: 'done' }, human)
    error.mockRestore()
    expect(done.repeatError).toContain('disk full')
    expect(planning.getWorkItem(task.id).status).toBe('done')
    expect(liveTitles()).toEqual(['Payroll'])
    // The rule stays, so finishing it again can still repeat.
    expect(planning.getRecurrence(task.id)).not.toBeNull()
  })

  describe('take turns (N2.3)', () => {
    const weekly = { every: 'week' as const, interval: 1 }

    function bins() {
      const sam = people.create({ name: 'Sam' })
      const alex = people.create({ name: 'Alex' })
      const jo = people.create({ name: 'Jo' })
      const task = planning.createWorkItem(
        'p1',
        { title: 'Bins out', targetDate: '2026-10-07', assigneeId: sam.id },
        human
      )
      planning.setRecurrence(task.id, { rule: weekly, rotation: [sam.id, alex.id, jo.id] }, human)
      return { sam, alex, jo, task }
    }

    it('gives each occurrence to the next person, through Done and Won’t do alike', () => {
      const { sam, alex, jo, task } = bins()
      expect(planning.getRecurrence(task.id)).toMatchObject({
        rotation: [sam.id, alex.id, jo.id],
        nextIndex: 0
      })
      // Sam has this one by hand; the rotation still starts with Sam.
      const second = planning.getWorkItem(
        planning.updateWorkItem(task.id, { status: 'done' }, human).repeatedAs!
      )
      expect(second.assigneeId).toBe(sam.id)
      // The rotation moved with the repeat, its turn on one.
      expect(planning.getRecurrence(second.id)).toMatchObject({
        rotation: [sam.id, alex.id, jo.id],
        nextIndex: 1
      })
      const { repeatedAs } = planning.closeWorkItemsAsWontDo([second.id], 'Away', human)
      const third = planning.getWorkItem(repeatedAs.get(second.id)!)
      expect(third.assigneeId).toBe(alex.id)
      expect(planning.getRecurrence(third.id)?.nextIndex).toBe(2)
      const fourth = planning.updateWorkItem(third.id, { status: 'done' }, human).repeatedAs!
      expect(planning.getWorkItem(fourth).assigneeId).toBe(jo.id)
      expect(planning.getRecurrence(fourth)?.nextIndex).toBe(0)
    })

    it('passes over an archived person, and keeps the assignee when everyone is', () => {
      const { sam, alex, jo, task } = bins()
      people.archive(sam.id)
      const second = planning.updateWorkItem(task.id, { status: 'done' }, human).repeatedAs!
      expect(planning.getWorkItem(second).assigneeId).toBe(alex.id)
      people.archive(alex.id)
      people.archive(jo.id)
      planning.updateWorkItem(second, { assigneeId: jo.id }, human)
      const third = planning.updateWorkItem(second, { status: 'done' }, human).repeatedAs!
      expect(planning.getWorkItem(third).assigneeId).toBe(jo.id)
      // The turn does not move while no one can take it.
      expect(planning.getRecurrence(third)?.nextIndex).toBe(2)
      const repeated = planning
        .listActivity('p1', third)
        .entries.find((entry) => entry.field === 'repeated')
      expect(repeated?.summary).toContain('Everyone taking turns is archived')
    })

    it('changing the assignee by hand leaves the turn alone', () => {
      const { alex, jo, task } = bins()
      planning.updateWorkItem(task.id, { assigneeId: jo.id }, human)
      expect(planning.getRecurrence(task.id)?.nextIndex).toBe(0)
      planning.setRecurrence(
        task.id,
        { rule: weekly, rotation: planning.getRecurrence(task.id)!.rotation, nextIndex: 1 },
        human
      )
      const next = planning.updateWorkItem(task.id, { status: 'done' }, human).repeatedAs!
      expect(planning.getWorkItem(next).assigneeId).toBe(alex.id)
    })

    it('keeps whoever was next when the list is edited without an index', () => {
      const { sam, alex, jo, task } = bins()
      planning.setRecurrence(
        task.id,
        { rule: weekly, rotation: [sam.id, alex.id, jo.id], nextIndex: 1 },
        human
      )
      // Alex is next; reorder and add someone: Alex is still next.
      const ru = people.create({ name: 'Ru' })
      planning.setRecurrence(task.id, { rule: weekly, rotation: [ru.id, jo.id, alex.id] }, human)
      expect(planning.getRecurrence(task.id)?.nextIndex).toBe(2)
      // Take Alex out: the person after them is next.
      planning.setRecurrence(task.id, { rule: weekly, rotation: [ru.id, jo.id] }, human)
      expect(planning.getRecurrence(task.id)?.nextIndex).toBe(0)
      const entries = planning.listActivity('p1', task.id).entries
      expect(entries.some((entry) => entry.summary.includes('set the task to take turns'))).toBe(
        true
      )
    })

    it('turning it off keeps the current assignee and refuses unknown people', () => {
      const { sam, task } = bins()
      planning.setRecurrence(task.id, { rule: weekly, rotation: null }, human)
      expect(planning.getRecurrence(task.id)).toMatchObject({ rotation: null, nextIndex: 0 })
      expect(planning.getWorkItem(task.id).assigneeId).toBe(sam.id)
      expect(() =>
        planning.setRecurrence(task.id, { rule: weekly, rotation: ['nobody'] }, human)
      ).toThrow('not found')
      expect(() =>
        planning.setRecurrence(task.id, { rule: weekly, rotation: [sam.id], nextIndex: 3 }, human)
      ).toThrow()
    })

    it('a failure picking the next person leaves the done task done and reports it', () => {
      const { task } = bins()
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const get = vi.spyOn(
        (planning as unknown as { people: { get: (id: string) => unknown } }).people,
        'get'
      )
      get.mockImplementation(() => {
        throw new Error('people unreadable')
      })
      const done = planning.updateWorkItem(task.id, { status: 'done' }, human)
      get.mockRestore()
      error.mockRestore()
      expect(done.repeatError).toContain('people unreadable')
      expect(planning.getWorkItem(task.id).status).toBe('done')
      expect(liveTitles()).toEqual(['Bins out'])
    })
  })
})
