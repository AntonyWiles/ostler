import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyDayTask, PlanMyDayCandidates, WatchedProject } from '../../src/shared/ostler-api'
import {
  myDayHours,
  myDayTotal,
  planSections,
  withoutMyDay
} from '../../src/shared/planning/my-day'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { HomeService } = await import('../../electron/services/home-service')
const { MyDayService } = await import('../../electron/services/my-day-service')
const { deleteProjectRows } = await import('../../electron/services/project-removal-service')
const { createMigratedDatabase } = await import('../helpers/database')

const human = { kind: 'human' as const }
const TODAY = '2026-10-16'

function project(id: string, name: string, estimateUnit: 'hours' | 'points' = 'hours') {
  return { id, name, color: '#3b82f6', enabled: true, estimateUnit } as WatchedProject
}

describe('My day (N1.4)', () => {
  const tempDir = useTempDir('ostler-my-day-')
  let planning: InstanceType<typeof PlanningService>
  let people: InstanceType<typeof PeopleService>
  let projects: WatchedProject[]
  let meId: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 16, 8, 0))
    const databasePath = await createMigratedDatabase(tempDir())
    projects = [project('p1', 'Website'), project('p2', 'Garden', 'points')]
    planning = new PlanningService(databasePath, () => projects.map((entry) => entry.id))
    people = new PeopleService(databasePath)
    meId = people.ensureMe('Jordan').id
  })

  afterEach(() => {
    planning.close()
    people.close()
    vi.useRealTimers()
  })

  const service = () =>
    new MyDayService({ db: planning.database, planning, getProjects: () => projects })
  const home = () =>
    new HomeService({
      db: planning.database,
      getProjects: () => projects,
      getMeId: () => meId,
      agentsOn: () => false,
      agentAttention: () => null
    })
  const add = (title: string, extra: object = {}, projectId = 'p1') =>
    planning.createWorkItem(projectId, { title, ...extra }, human)
  const titles = (tasks: { title: string }[]) => tasks.map((task) => task.title)

  it('adds at the end, before or after another entry, moves and removes', () => {
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((title) => add(title))
    const day = service()
    day.add(a.id, { date: TODAY }, human)
    day.add(b.id, { date: TODAY }, human)
    day.add(c.id, { date: TODAY, beforeId: a.id }, human)
    day.add(d.id, { date: TODAY, afterId: a.id }, human)
    expect(titles(day.list(TODAY))).toEqual(['C', 'A', 'D', 'B'])

    day.move(b.id, { date: TODAY, beforeId: c.id })
    expect(titles(day.list(TODAY))).toEqual(['B', 'C', 'A', 'D'])
    day.move(b.id, { date: TODAY })
    expect(titles(day.list(TODAY))).toEqual(['C', 'A', 'D', 'B'])

    expect(day.remove(a.id, TODAY)).toBe(true)
    expect(day.remove(a.id, TODAY)).toBe(false)
    expect(titles(day.list(TODAY))).toEqual(['C', 'D', 'B'])
    // The task itself is untouched.
    expect(planning.getWorkItem(a.id).title).toBe('A')
  })

  it('keeps one entry per task per day, and a separate list for each day', () => {
    const a = add('A')
    const day = service()
    expect(day.add(a.id, { date: TODAY }, human).already).toBe(false)
    expect(day.add(a.id, { date: TODAY }, human).already).toBe(true)
    day.add(a.id, { date: '2026-10-17' }, human)
    expect(titles(day.list(TODAY))).toEqual(['A'])
    expect(titles(day.list('2026-10-17'))).toEqual(['A'])
  })

  it('never changes the Board order when moving in My day', () => {
    const a = add('A')
    const b = add('B')
    const before = [planning.getWorkItem(a.id).orderKey, planning.getWorkItem(b.id).orderKey]
    const day = service()
    day.add(a.id, { date: TODAY }, human)
    day.add(b.id, { date: TODAY, beforeId: a.id }, human)
    day.move(a.id, { date: TODAY, beforeId: b.id })
    expect([planning.getWorkItem(a.id).orderKey, planning.getWorkItem(b.id).orderKey]).toEqual(
      before
    )
  })

  it('leaves archived, binned, Won’t do and hidden tasks out when reading, keeping done ones', () => {
    const tasks = ['Archived', 'Binned', 'Wont', 'Later', 'Done', 'Kept'].map((title) => add(title))
    const day = service()
    for (const task of tasks) day.add(task.id, { date: TODAY }, human)
    planning.archiveWorkItem(tasks[0].id, human)
    planning.moveWorkItemToBin(tasks[1].id, human)
    planning.closeWorkItemsAsWontDo([tasks[2].id], '', human)
    planning.updateWorkItem(tasks[3].id, { someday: true }, human)
    planning.updateWorkItem(tasks[4].id, { status: 'done' }, human)
    expect(titles(day.list(TODAY))).toEqual(['Done', 'Kept'])
    expect(titles(home().getMyWork({ today: TODAY }).myDay)).toEqual(['Done', 'Kept'])
  })

  it('brings a hidden task back when adding it, and says so', () => {
    const someday = add('Someday', { someday: true })
    const later = add('Later', { showFrom: '2026-11-01' })
    const day = service()
    expect(day.add(someday.id, { date: TODAY }, human).broughtBack).toBe('someday')
    expect(planning.getWorkItem(someday.id).someday).toBe(false)
    expect(day.add(later.id, { date: TODAY }, human).broughtBack).toBe('later')
    expect(planning.getWorkItem(later.id).showFrom).toBeNull()
    expect(titles(day.list(TODAY))).toEqual(['Someday', 'Later'])
  })

  it('keeps a project token to its own project', () => {
    const mine = add('Mine')
    const theirs = add('Theirs', {}, 'p2')
    const day = service()
    day.add(theirs.id, { date: TODAY }, human)
    expect(() => day.add(theirs.id, { date: TODAY }, human, 'p1')).toThrow(/not found/)
    day.add(mine.id, { date: TODAY }, human, 'p1')
    expect(titles(day.list(TODAY, 'p1'))).toEqual(['Mine'])
    expect(() => day.move(mine.id, { date: TODAY, beforeId: theirs.id }, 'p1')).toThrow(
      /not in My day/
    )
    expect(day.remove(theirs.id, TODAY, 'p1')).toBe(false)
    expect(titles(day.list(TODAY))).toEqual(['Theirs', 'Mine'])
  })

  it('removes a project’s entries with the project', () => {
    const day = service()
    day.add(add('Mine').id, { date: TODAY }, human)
    day.add(add('Theirs', {}, 'p2').id, { date: TODAY }, human)
    deleteProjectRows(planning.database, 'p1')
    expect(planning.database.prepare('SELECT project_id FROM my_day_entries').all()).toEqual([
      { project_id: 'p2' }
    ])
  })

  it('Start my day saves exactly the picked tasks, in order', () => {
    const [a, b, c] = ['A', 'B', 'C'].map((title) => add(title))
    const day = service()
    day.add(a.id, { date: TODAY }, human)
    expect(titles(day.start(TODAY, [c.id, b.id], human))).toEqual(['C', 'B'])
  })

  it('offers the unfinished tasks of the last day with a list, not only yesterday', () => {
    const [done, open, gone, kept] = ['Done', 'Open', 'Gone', 'Kept'].map((title) => add(title))
    const day = service()
    // Tuesday had a list; Wednesday and Thursday had none.
    for (const task of [done, open, gone, kept]) day.add(task.id, { date: '2026-10-13' }, human)
    planning.updateWorkItem(done.id, { status: 'done' }, human)
    // An older list is never offered.
    day.add(add('Older').id, { date: '2026-10-12' }, human)

    const leftOver = home().getMyWork({ today: TODAY }).leftOver
    expect(leftOver?.date).toBe('2026-10-13')
    expect(titles(leftOver!.tasks)).toEqual(['Open', 'Gone', 'Kept'])

    // Nothing moved by itself.
    expect(day.list(TODAY)).toEqual([])

    // Add to today takes one; let go the others.
    day.add(kept.id, { date: TODAY }, human)
    expect(titles(home().getMyWork({ today: TODAY }).leftOver!.tasks)).toEqual(['Open', 'Gone'])
    day.release('2026-10-13', [gone.id])
    expect(titles(home().getMyWork({ today: TODAY }).leftOver!.tasks)).toEqual(['Open'])
    day.release('2026-10-13')
    expect(home().getMyWork({ today: TODAY }).leftOver).toBeNull()
  })

  it('offers Today’s tasks and high-priority undated tasks for Me', () => {
    add('Overdue', { targetDate: '2026-10-10', assigneeId: meId, estimate: 2 })
    add('Due today', { targetDate: TODAY })
    add('High', { priority: 'high', assigneeId: meId, estimate: 3 }, 'p2')
    add('High, dated', { priority: 'high', assigneeId: meId, targetDate: '2026-12-01' })
    add('Medium', { priority: 'medium', assigneeId: meId })
    const plan = home().getPlanMyDay({ today: TODAY })
    expect(titles(plan.today)).toEqual(['Overdue', 'Due today'])
    expect(plan.highPriority.map((task) => [task.title, task.estimate, task.estimateUnit])).toEqual(
      [['High', 3, 'points']]
    )
  })
})

describe('Plan my day rules (N1.4)', () => {
  const task = (id: string, extra: Partial<MyDayTask> = {}): MyDayTask => ({
    id,
    projectId: 'p1',
    projectName: 'Website',
    projectColor: '#000',
    title: id,
    status: 'ready',
    priority: 'medium',
    targetDate: null,
    assigneeId: null,
    linked: false,
    estimate: null,
    estimateUnit: 'hours',
    ...extra
  })

  it('offers each of Today’s tasks once, by reason, leaving out those already picked', () => {
    const candidates: PlanMyDayCandidates = {
      myDay: [task('picked')],
      leftOver: { date: '2026-10-14', tasks: [task('left'), task('overdue')] },
      today: [
        task('overdue', { reason: 'overdue' }),
        task('picked', { reason: 'today' }),
        task('due', { reason: 'today' }),
        task('active', { reason: 'in-progress' }),
        task('new', { reason: 'new-today' })
      ],
      highPriority: [task('high'), task('active')]
    }
    expect(
      planSections(candidates).map((section) => [section.id, section.tasks.map((t) => t.id)])
    ).toEqual([
      ['leftOver', ['left', 'overdue']],
      ['today', ['due']],
      ['inProgress', ['active']],
      ['newToday', ['new']],
      ['highPriority', ['high']]
    ])
  })

  it('totals hours, counts unestimated tasks, and keeps points apart', () => {
    expect(
      myDayTotal([
        task('a', { estimate: 2 }),
        task('b', { estimate: 1.5 }),
        task('c'),
        task('d', { estimate: 5, estimateUnit: 'points' }),
        task('e', { estimateUnit: 'points' })
      ])
    ).toEqual({ hours: 3.5, unestimated: 1, pointsTasks: 2, points: 5 })
  })

  it('takes today’s hours from capacity, or the hours typed in', () => {
    expect(myDayHours({ weeklyCapacityHours: 30, workingDays: [1, 2, 3, 4, 5] }, 4)).toEqual({
      hours: 6,
      fromCapacity: true
    })
    expect(myDayHours({ weeklyCapacityHours: 32, workingDays: [1, 2, 3, 4] }, null).hours).toBe(8)
    expect(myDayHours({ weeklyCapacityHours: null }, 5)).toEqual({ hours: 5, fromCapacity: false })
    expect(myDayHours(null, null)).toEqual({ hours: null, fromCapacity: false })
  })

  it('leaves My day’s tasks out of Today', () => {
    expect(withoutMyDay([task('a'), task('b')], [task('b')]).map((t) => t.id)).toEqual(['a'])
  })
})
