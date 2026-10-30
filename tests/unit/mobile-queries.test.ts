import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanningWorkItemStatus, WatchedProject } from '../../src/shared/ostler-api'
import { TASK_STATUSES } from '../../src/shared/task-labels'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { MyDayService } = await import('../../electron/services/my-day-service')
const { ReportService } = await import('../../electron/services/report-service')
const { createMigratedDatabase } = await import('../helpers/database')
const queries = await import('../../mobile/src/data/queries')

// What the phone's screens ask, against a database the desktop's own PlanningService filled: each
// answer must be what the desktop shows (mobile plan, prompt 11).

const human = { kind: 'human' as const }
const PROJECT = 'p1'
const OTHER = 'p2'
const TODAY = '2026-10-16'

const watched = (id: string, name: string) =>
  ({ id, name, color: '#3b82f6', enabled: true, estimateUnit: 'points' }) as WatchedProject

describe('the phone reads projects, status, My Day and tasks as the desktop does (mobile plan, prompt 11)', () => {
  const tempDir = useTempDir('ostler-mobile-queries-')
  let planning: InstanceType<typeof PlanningService>
  let people: InstanceType<typeof PeopleService>
  let projects: WatchedProject[]
  let anna: string
  const ids: Record<string, string> = {}

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 16, 8, 0))
    const databasePath = await createMigratedDatabase(tempDir())
    projects = [watched(PROJECT, 'House'), watched(OTHER, 'Garden')]
    planning = new PlanningService(databasePath, () => projects.map((entry) => entry.id))
    people = new PeopleService(databasePath)
    anna = people.create({ name: 'Anna' }).id

    const make = (title: string, extra: object = {}, project = PROJECT) =>
      planning.createWorkItem(project, { title, ...extra }, human)

    const milestone = planning.createMilestone(PROJECT, {
      name: 'Handover',
      targetDate: '2026-11-20'
    })
    planning.createMilestone(PROJECT, { name: 'Sooner', targetDate: '2026-10-30' })
    planning.createMilestone(PROJECT, { name: 'Dateless' })

    ids.backlog = make('Pick tiles', { status: 'backlog' }).id
    ids.ready = make('Order paint', { status: 'ready', targetDate: '2026-10-20' }).id
    ids.active = make('Fit sink', {
      status: 'active',
      targetDate: '2026-10-10',
      assigneeId: anna,
      milestoneId: milestone.id,
      labels: ['kitchen'],
      description: 'Under the window.',
      acceptanceCriteria: ['Pipes tight', 'Taps work']
    }).id
    ids.blocked = make('Wait for worktop', { status: 'blocked', targetDate: '2026-10-15' }).id
    ids.done = make('Strip wallpaper', { status: 'ready' }).id
    ids.doneToo = make('Clear the room', { status: 'ready' }).id
    ids.archived = make('Old idea', { status: 'ready' }).id
    ids.deleted = make('Mistake', { status: 'ready' }).id
    ids.other = make('Dig bed', { status: 'ready' }, OTHER).id

    planning.updateWorkItem(ids.done, { status: 'active' }, human)
    planning.updateWorkItem(ids.done, { status: 'done' }, human)
    planning.updateWorkItem(ids.doneToo, { status: 'done' }, human)
    planning.archiveWorkItem(ids.archived, human)
    planning.deleteWorkItem(ids.deleted, human)
    planning.setChecklistItemChecked(ids.active, 'Taps work', true, human)
    planning.addComment(ids.active, 'Plumber booked for Friday.', human)
  })

  afterEach(() => {
    planning.close()
    people.close()
    vi.useRealTimers()
  })

  const db = () => planning.database

  it('lists each project with the counts of its live tasks, leaving out archived and deleted ones', () => {
    const list = queries.projects(db())
    expect(list.map((project) => project.id).sort()).toEqual([PROJECT, OTHER])
    const house = list.find((project) => project.id === PROJECT)!
    const desktop = planning.listWorkItems(PROJECT, 'planned')
    expect(house.taskCount).toBe(desktop.length)
    expect(house.doneCount).toBe(desktop.filter((item) => item.status === 'done').length)
    expect(house.openCount).toBe(desktop.filter((item) => item.status !== 'done').length)
    expect({ total: house.taskCount, done: house.doneCount }).toEqual({ total: 6, done: 2 })
    expect(list.find((project) => project.id === OTHER)!.taskCount).toBe(1)
  })

  it('lists a joined project that has no tasks yet, but not the personal space', () => {
    const share = db().prepare(
      `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at, kind)
       VALUES (?, ?, 'gdrive:folder00001', 'm', 'd', 1, 1, ?)`
    )
    share.run('empty-joined', 'share-empty', 'project')
    share.run('~personal', 'share-personal', 'personal')
    const empty = queries.projects(db()).find((project) => project.id === 'empty-joined')
    expect(empty).toMatchObject({ taskCount: 0, openCount: 0 })
    expect(queries.projects(db()).map((project) => project.id)).not.toContain('~personal')
  })

  it('groups a project’s tasks by status with the desktop’s counts and order', () => {
    const groups = queries.tasksByStatus(db(), PROJECT)
    const desktop = planning.listWorkItems(PROJECT, 'planned')
    for (const status of TASK_STATUSES as readonly PlanningWorkItemStatus[]) {
      expect(groups[status].map((item) => item.id)).toEqual(
        desktop.filter((item) => item.status === status).map((item) => item.id)
      )
    }
    expect(TASK_STATUSES.map((status) => groups[status].length)).toEqual([1, 1, 1, 1, 0, 2])
  })

  it('reports the figures the desktop Overview shows', () => {
    const now = Date.now()
    const reports = new ReportService({
      planning,
      listPeople: () => people.list().map((person) => ({ id: person.id, name: person.name }))
    })
    const desktop = reports.getReport(projects[0], '30d', now).keyNumbers
    const phone = queries.projectOverview(db(), PROJECT, now)
    expect(phone.keyNumbers).toEqual({
      open: desktop.open,
      doneInRange: desktop.doneInRange,
      overdueNow: desktop.overdueNow,
      dueNext7Days: desktop.dueNext7Days
    })
    // Four open tasks, two finished today, two open tasks past their date, one due within a week.
    expect(phone.keyNumbers).toEqual({ open: 4, doneInRange: 2, overdueNow: 2, dueNext7Days: 1 })
  })

  it('names the open milestone with the soonest date as the Projects board does', () => {
    const phone = queries.projectOverview(db(), PROJECT, Date.now())
    expect(phone.nextMilestone).toMatchObject({ name: 'Sooner', targetDate: '2026-10-30' })
    expect(queries.projectOverview(db(), OTHER, Date.now()).nextMilestone).toBeNull()
  })

  it('returns My Day in the person’s order, leaving out what the desktop leaves out', () => {
    const day = new MyDayService({ db: db(), planning, getProjects: () => projects })
    day.add(ids.active, { date: TODAY }, human)
    day.add(ids.other, { date: TODAY }, human, OTHER)
    day.add(ids.ready, { date: TODAY, beforeId: ids.active }, human)
    day.add(ids.done, { date: TODAY }, human)
    day.add(ids.ready, { date: '2026-10-17' }, human)
    const desktop = day.list(TODAY)
    expect(desktop.map((entry) => entry.id)).toEqual([ids.ready, ids.active, ids.other, ids.done])
    expect(queries.myDay(db(), TODAY).map((entry) => entry.id)).toEqual(
      desktop.map((entry) => entry.id)
    )
    // An archived task drops out of the list on both.
    planning.archiveWorkItem(ids.ready, human)
    expect(queries.myDay(db(), TODAY).map((entry) => entry.id)).toEqual(
      day.list(TODAY).map((entry) => entry.id)
    )
    expect(queries.myDay(db(), '2026-10-18')).toEqual([])
  })

  it('reads one task with its people, milestone, checklist and comments', () => {
    const item = planning.getWorkItem(ids.active)
    const phone = queries.task(db(), ids.active)!
    expect(phone).toMatchObject({
      id: item.id,
      projectId: PROJECT,
      title: 'Fit sink',
      status: 'active',
      priority: item.priority,
      targetDate: '2026-10-10',
      description: 'Under the window.',
      labels: ['kitchen'],
      assigneeName: 'Anna',
      milestoneName: 'Handover',
      archived: false
    })
    expect(phone.checklist).toEqual([
      { text: 'Pipes tight', checked: false },
      { text: 'Taps work', checked: true }
    ])
    expect(phone.checklist.filter((line) => line.checked).map((line) => line.text)).toEqual(
      item.checkedCriteria
    )
    expect(phone.comments.map((comment) => comment.body)).toEqual(['Plumber booked for Friday.'])
    expect(queries.task(db(), ids.archived)?.archived).toBe(true)
    expect(queries.task(db(), ids.deleted)).toBeNull()
    expect(queries.task(db(), 'no-such-task')).toBeNull()
  })

  it('names who wrote each comment as the desktop history does', () => {
    planning.addComment(ids.blocked, 'From Anna.', { kind: 'human', personId: anna })
    planning.addComment(ids.blocked, 'From a script.', { kind: 'automation' })
    planning.addComment(ids.blocked, 'From nobody known.', human)
    const comments = queries.task(db(), ids.blocked)!.comments
    expect(comments.map(({ author, byPerson }) => ({ author, byPerson }))).toEqual([
      { author: 'Anna', byPerson: true },
      { author: 'Automation API', byPerson: false },
      { author: 'Someone', byPerson: true }
    ])
    expect(comments.every((comment) => comment.createdAt > 0)).toBe(true)
  })
})
