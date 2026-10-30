import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type OstlerConfig, type WatchedProject } from '../../src/shared/ostler-api'
import { useTempDir } from '../helpers/temp-dir'

const shown: { title: string; body: string }[] = []
vi.mock('electron', () => ({
  Notification: class {
    static isSupported = () => true
    readonly handlers = new Map<string, () => void>()
    constructor(private readonly options: { title: string; body: string }) {}
    on(event: string, handler: () => void) {
      this.handlers.set(event, handler)
    }
    show() {
      shown.push(this.options)
    }
  },
  BrowserWindow: class {}
}))

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { HomeService } = await import('../../electron/services/home-service')
const { InboxService } = await import('../../electron/services/inbox-service')
const { agentSources, blockerSource, reminderSource } =
  await import('../../electron/services/inbox-sources')
const { NotificationService } = await import('../../electron/services/notification-service')
const { snoozeUntil } = await import('../../electron/ipc/home-handlers')
const { createMigratedDatabase } = await import('../helpers/database')

const human = { kind: 'human' as const }

function project(id: string, name: string, enabled = true): WatchedProject {
  return { id, name, color: '#3b82f6', enabled } as WatchedProject
}

describe('Home and the Inbox (P5.6)', () => {
  const tempDir = useTempDir('ostler-home-')
  let planning: InstanceType<typeof PlanningService>
  let people: InstanceType<typeof PeopleService>
  let projects: WatchedProject[]
  let agentsOn: boolean
  let meId: string
  let bobId: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 7, 8, 0))
    const databasePath = await createMigratedDatabase(tempDir())
    projects = [project('p1', 'Website'), project('p2', 'Garden'), project('p3', 'Taxes')]
    agentsOn = false
    planning = new PlanningService(databasePath, () => projects.map((entry) => entry.id))
    people = new PeopleService(databasePath)
    meId = people.ensureMe('Jordan').id
    bobId = people.create({ name: 'Bob' }).id
  })

  afterEach(() => {
    planning.close()
    people.close()
    vi.useRealTimers()
  })

  const home = () =>
    new HomeService({
      db: planning.database,
      getProjects: () => projects,
      getMeId: () => meId,
      agentsOn: () => agentsOn,
      agentAttention: (entry) =>
        entry.id === 'p2'
          ? {
              questions: [{ id: 'q1', text: 'Which colour?', at: 5, taskId: null }],
              reviews: [{ id: 's1', title: 'Fix the gate', at: 6, taskId: null }]
            }
          : null
    })

  it('getMyWork lists Today and Upcoming across three projects, for a fixed today', () => {
    const add = (projectId: string, title: string, extra: object) =>
      planning.createWorkItem(projectId, { title, ...extra }, human)
    add('p1', 'Overdue mine', { targetDate: '2026-10-01', assigneeId: meId })
    add('p2', 'Due today, nobody', { targetDate: '2026-10-07' })
    add('p3', 'In progress mine', { status: 'active', assigneeId: meId })
    add('p3', 'In progress, Bob', { status: 'active', assigneeId: bobId })
    add('p1', 'Tomorrow mine', { targetDate: '2026-10-08', assigneeId: meId })
    add('p2', 'Tomorrow nobody', { targetDate: '2026-10-08' })
    add('p3', 'In a week mine', { targetDate: '2026-10-14', assigneeId: meId })
    add('p1', 'Too far mine', { targetDate: '2026-10-15', assigneeId: meId })
    add('p2', 'Done today', { targetDate: '2026-10-07', status: 'done' })
    const archived = add('p3', 'Archived today', { targetDate: '2026-10-07' })
    planning.archiveWorkItem(archived.id, human)

    const work = home().getMyWork({ today: '2026-10-07' })
    expect(work.today.map((task) => [task.title, task.reason, task.projectName])).toEqual([
      ['Overdue mine', 'overdue', 'Website'],
      ['Due today, nobody', 'today', 'Garden'],
      ['In progress mine', 'in-progress', 'Taxes']
    ])
    // Unassigned tasks count as mine only in Today.
    expect(work.upcoming).toEqual([
      { date: '2026-10-08', tasks: [expect.objectContaining({ title: 'Tomorrow mine' })] },
      { date: '2026-10-14', tasks: [expect.objectContaining({ title: 'In a week mine' })] }
    ])

    projects = [project('p1', 'Website'), project('p2', 'Garden', false), project('p3', 'Taxes')]
    expect(
      home()
        .getMyWork({ today: '2026-10-07' })
        .today.map((task) => task.title)
    ).not.toContain('Due today, nobody')
  })

  it('leaves hidden tasks out of Today and Upcoming, and adds one shown from today (N1.1a)', () => {
    const add = (title: string, extra: object) =>
      planning.createWorkItem('p1', { title, ...extra }, human)
    add('Overdue but later', { targetDate: '2026-10-01', showFrom: '2026-10-08' })
    add('Active in Someday', { status: 'active', someday: true })
    add('Tomorrow, later', { targetDate: '2026-10-08', assigneeId: meId, showFrom: '2026-10-09' })
    add('Tomorrow in Someday', { targetDate: '2026-10-08', assigneeId: meId, someday: true })
    add('New today', { showFrom: '2026-10-07' })
    add('Shown since yesterday', { showFrom: '2026-10-06', targetDate: '2026-10-07' })
    add('New today, Someday', { showFrom: '2026-10-07', someday: true })
    add('New today, Bob', { showFrom: '2026-10-07', assigneeId: bobId })

    const work = home().getMyWork({ today: '2026-10-07' })
    expect(work.today.map((task) => [task.title, task.reason])).toEqual([
      ['Shown since yesterday', 'today'],
      ['New today', 'new-today']
    ])
    expect(work.upcoming).toEqual([])

    // The next day the show-from date has come: it is back, overdue.
    expect(
      home()
        .getMyWork({ today: '2026-10-08' })
        .today.map((task) => task.title)
    ).toContain('Overdue but later')
  })

  it('getNeedsYou lists blocked tasks, and agent questions and reviews only while agents are on', () => {
    planning.createWorkItem('p1', { title: 'Stuck', status: 'blocked' }, human)
    expect(
      home()
        .getNeedsYou()
        .map((entry) => entry.kind)
    ).toEqual(['blocked'])
    agentsOn = true
    expect(
      home()
        .getNeedsYou()
        .map((entry) => [entry.kind, entry.title])
    ).toEqual([
      ['blocked', 'Stuck'],
      ['question', 'Which colour?'],
      ['review', 'Fix the gate']
    ])
  })

  it('getNeedsYou leaves out On hold and Done projects, as Today and Upcoming do', () => {
    planning.createWorkItem('p1', { title: 'Stuck here', status: 'blocked' }, human)
    planning.createWorkItem('p2', { title: 'Stuck on hold', status: 'blocked' }, human)
    planning.createWorkItem('p3', { title: 'Stuck when done', status: 'blocked' }, human)
    agentsOn = true
    projects = [
      { ...project('p1', 'Website'), stage: 'planning' },
      { ...project('p2', 'Garden'), stage: 'on-hold' },
      { ...project('p3', 'Taxes'), stage: 'done' }
    ] as WatchedProject[]
    // p2's agent question and review go with it.
    expect(
      home()
        .getNeedsYou()
        .map((entry) => entry.title)
    ).toEqual(['Stuck here'])
    // Back to Active: they come back.
    projects = [project('p1', 'Website'), { ...project('p2', 'Garden'), stage: 'active' }]
    expect(
      home()
        .getNeedsYou()
        .map((entry) => entry.title)
        .sort()
    ).toEqual(['Fix the gate', 'Stuck here', 'Stuck on hold', 'Which colour?'])
  })

  const inbox = () => {
    const service = new InboxService(planning.database)
    service.registerSource(
      'reminders',
      reminderSource(planning.database, () => projects)
    )
    service.registerSource(
      'blockers',
      blockerSource(planning.database, () => projects)
    )
    const agents = agentSources(
      () => projects,
      () => agentsOn,
      (entry) =>
        entry.id === 'p2'
          ? {
              questions: [{ id: 'q1', text: 'Which colour?', at: 50, taskId: null }],
              reviews: []
            }
          : null
    )
    service.registerSource('questions', agents.questions)
    return service
  }

  it('derives items from its sources, newest first, with read and archived state stored', () => {
    const task = planning.createWorkItem(
      'p1',
      { title: 'Pay invoice', targetDate: '2026-10-07' },
      human
    )
    const blocked = planning.createWorkItem('p3', { title: 'Lodge return' }, human)
    planning.reportBlocker(blocked.id, 'Need the PAYE summary', 'human')
    vi.setSystemTime(new Date(2026, 9, 7, 9, 0))
    const [reminder] = planning.reminders.dueBy(Date.now(), ['p1'])
    planning.reminders.markDelivered([reminder.id], Date.now())
    agentsOn = true

    const service = inbox()
    let list = service.list()
    expect(list.items.map((item) => [item.kind, item.title, item.body])).toEqual([
      ['reminder', 'Pay invoice', 'Due today · Website'],
      ['blocker', 'Lodge return', 'Need the PAYE summary'],
      ['question', 'An agent has a question · Garden', 'Which colour?']
    ])
    expect(list.items[0]).toMatchObject({ taskId: task.id, projectId: 'p1', readAt: null })
    expect(list.unreadCount).toBe(3)

    service.setRead([`reminder:${reminder.id}`], true)
    expect(service.list().unreadCount).toBe(2)
    service.setRead([`reminder:${reminder.id}`], false)
    expect(service.list().unreadCount).toBe(3)

    service.archive(['question:p2:q1'])
    list = service.list()
    expect(list.items.map((item) => item.kind)).toEqual(['reminder', 'blocker'])
    expect(list.unreadCount).toBe(2)
    service.unarchive(['question:p2:q1'])
    expect(service.list().items).toHaveLength(3)

    service.markAllRead()
    expect(service.list().unreadCount).toBe(0)

    // Agents off: their items leave; a disabled project's items leave with it.
    agentsOn = false
    projects = [project('p1', 'Website', false), project('p2', 'Garden'), project('p3', 'Taxes')]
    expect(service.list().items.map((item) => item.kind)).toEqual(['blocker'])
    expect(() => service.setRead(['not a key'], true)).toThrow('not an Inbox item')
  })

  it('leaves out reminders and blockers of archived or recycled tasks, which open nothing', () => {
    const archived = planning.createWorkItem(
      'p1',
      { title: 'Archived', targetDate: '2026-10-07' },
      human
    )
    const binned = planning.createWorkItem(
      'p1',
      { title: 'Binned', targetDate: '2026-10-07' },
      human
    )
    planning.reportBlocker(binned.id, 'Stuck', 'human')
    const stuck = planning.createWorkItem('p1', { title: 'Stuck archived' }, human)
    planning.reportBlocker(stuck.id, 'Waiting', 'human')
    vi.setSystemTime(new Date(2026, 9, 7, 9, 0))
    const due = planning.reminders.dueBy(Date.now(), ['p1'])
    planning.reminders.markDelivered(
      due.map((reminder) => reminder.id),
      Date.now()
    )
    expect(inbox().list().items).toHaveLength(4)

    planning.archiveWorkItem(archived.id, human)
    planning.archiveWorkItem(stuck.id, human)
    planning.deleteWorkItem(binned.id, human)
    expect(inbox().list().items).toEqual([])
  })

  it('reports only items that arrived since it last looked', () => {
    const service = inbox()
    const blocked = planning.createWorkItem('p3', { title: 'Lodge return' }, human)
    planning.reportBlocker(blocked.id, 'Waiting on IRD', 'human')
    expect(service.refresh()).toEqual([])
    agentsOn = true
    expect(service.refresh().map((item) => item.key)).toEqual(['question:p2:q1'])
    expect(service.refresh()).toEqual([])
  })

  it('snoozes for an hour or until tomorrow at 09:00', () => {
    const now = new Date(2026, 9, 7, 16, 30)
    expect(snoozeUntil('hour', now)).toBe(new Date(2026, 9, 7, 17, 30).getTime())
    expect(snoozeUntil('tomorrow', now)).toBe(new Date(2026, 9, 8, 9, 0).getTime())
  })

  it('snoozes a reminder that keeps reminding until tomorrow at its own time (N1.7)', () => {
    const now = new Date(2026, 9, 7, 16, 30)
    const remindAt = new Date(2026, 9, 7, 10, 45).getTime()
    expect(snoozeUntil('tomorrow', now, remindAt)).toBe(new Date(2026, 9, 8, 10, 45).getTime())
    expect(snoozeUntil('hour', now, remindAt)).toBe(new Date(2026, 9, 7, 17, 30).getTime())
  })
})

describe('the notification gate', () => {
  const config = (notifications: Partial<OstlerConfig['notifications']>): OstlerConfig =>
    ({
      ...DEFAULT_CONFIG,
      projects: [project('p1', 'Website'), project('p2', 'Garden', false)],
      notifications: { ...DEFAULT_CONFIG.notifications, ...notifications }
    }) as OstlerConfig

  const gate = (notifications: Partial<OstlerConfig['notifications']>, hour = 12) =>
    new NotificationService(
      () => config(notifications),
      {} as never,
      () => new Date(2026, 9, 7, hour, 0)
    )

  it('respects the switch, each source, quiet hours and disabled projects', () => {
    expect(gate({}).shouldNotify('reminder', 'p1')).toBe(true)
    expect(gate({ enabled: false }).shouldNotify('reminder', 'p1')).toBe(false)
    expect(gate({ onReminder: false }).shouldNotify('reminder', 'p1')).toBe(false)
    expect(gate({ onAgentQuestion: false }).shouldNotify('agent_question', 'p1')).toBe(false)
    expect(gate({ onBlocker: false }).shouldNotify('blocker', 'p1')).toBe(false)
    expect(gate({ onReviewWaiting: false }).shouldNotify('review_waiting', 'p1')).toBe(false)
    expect(gate({}).shouldNotify('reminder', 'p2')).toBe(false)
    expect(gate({ quietHoursEnabled: true }, 23).shouldNotify('reminder', 'p1')).toBe(false)
    expect(gate({ quietHoursEnabled: true }, 12).shouldNotify('reminder', null)).toBe(true)
  })

  it('shows reminders back to back, without the rate limit', () => {
    shown.length = 0
    const service = new NotificationService(() => config({}), {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: () => {} }
    } as never)
    service.notify('reminder', 'Due today · Website', 'One', 'p1')
    service.notify('reminder', 'Due today · Website', 'Two', 'p1')
    expect(shown.map((entry) => entry.body)).toEqual(['One', 'Two'])
  })

  it('holds each notification until it is clicked, so Windows cannot collect it and lose the click', () => {
    const service = new NotificationService(() => config({}), {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: () => {} }
    } as never)
    const opened: unknown[] = []
    service.setShell({ open: (target) => opened.push(target) })
    service.notify('reminder', 'Due today · Website', 'One', 'p1')
    const held = (service as unknown as { clickable: Set<{ handlers: Map<string, () => void> }> })
      .clickable
    expect(held.size).toBe(1)
    const [notification] = held
    notification.handlers.get('click')?.()
    expect(opened).toEqual([{ kind: 'project', projectId: 'p1', view: 'overview' }])
    expect(held.size).toBe(0)
  })
})
