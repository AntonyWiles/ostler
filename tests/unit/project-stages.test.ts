import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchedProject } from '../../src/shared/ostler-api'
import {
  isProjectInPlay,
  isStageInPlay,
  normalizeProjectStage,
  normalizeProjectStageNames,
  parseProjectStage,
  type ProjectStage
} from '../../src/shared/project-stages'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({ Notification: class {}, BrowserWindow: class {} }))

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { HomeService } = await import('../../electron/services/home-service')
const { InboxService } = await import('../../electron/services/inbox-service')
const { agentSources, blockerSource, reminderSource } =
  await import('../../electron/services/inbox-sources')
const { createMigratedDatabase } = await import('../helpers/database')

describe('the in-play rule (N5.3)', () => {
  it('keeps enabled Planning and Active projects only', () => {
    const cases: [boolean, ProjectStage | undefined, boolean][] = [
      [true, 'planning', true],
      [true, 'active', true],
      [true, undefined, true],
      [true, 'on-hold', false],
      [true, 'done', false],
      [false, 'active', false],
      [false, 'planning', false]
    ]
    for (const [enabled, stage, inPlay] of cases) {
      expect(isProjectInPlay({ enabled, stage })).toBe(inPlay)
    }
  })

  it('reads the stage alone the same way, for the sidebar and status update reminders', () => {
    expect(isStageInPlay('planning')).toBe(true)
    expect(isStageInPlay('active')).toBe(true)
    expect(isStageInPlay(undefined)).toBe(true)
    expect(isStageInPlay('something else')).toBe(true)
    expect(isStageInPlay('on-hold')).toBe(false)
    expect(isStageInPlay('done')).toBe(false)
  })

  it('reads an unknown stage as Active, refuses one when setting, and trims names', () => {
    expect(normalizeProjectStage('paused')).toBe('active')
    expect(parseProjectStage('on-hold')).toBe('on-hold')
    expect(() => parseProjectStage('paused')).toThrow(/planning, active, on-hold, done/)
    expect(normalizeProjectStageNames({ done: ' Shipped ', active: 3 })).toEqual({
      planning: '',
      active: '',
      'on-hold': '',
      done: 'Shipped'
    })
    expect(normalizeProjectStageNames({ planning: 'x'.repeat(60) }).planning).toHaveLength(40)
  })
})

const human = { kind: 'human' as const }

function project(id: string, name: string, stage: ProjectStage = 'active'): WatchedProject {
  return { id, name, color: '#3b82f6', enabled: true, stage } as WatchedProject
}

describe('On hold and Done projects leave the daily lists (N5.3)', () => {
  const tempDir = useTempDir('ostler-stages-')
  let planning: InstanceType<typeof PlanningService>
  let people: InstanceType<typeof PeopleService>
  let projects: WatchedProject[]
  let meId: string

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 7, 8, 0))
    const databasePath = await createMigratedDatabase(tempDir())
    projects = [project('p1', 'Website'), project('p2', 'Garden'), project('p3', 'Taxes')]
    planning = new PlanningService(databasePath, () => projects.map((entry) => entry.id))
    people = new PeopleService(databasePath)
    meId = people.ensureMe('Jordan').id
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
      agentsOn: () => true,
      agentAttention: () => null
    })

  const setStages = (p2: ProjectStage, p3: ProjectStage) => {
    projects = [
      project('p1', 'Website', 'planning'),
      project('p2', 'Garden', p2),
      project('p3', 'Taxes', p3)
    ]
  }

  it('leaves them out of Today, Upcoming and My work, and brings them back on Active', () => {
    for (const id of ['p1', 'p2', 'p3']) {
      planning.createWorkItem(
        id,
        { title: `Due ${id}`, targetDate: '2026-10-07', assigneeId: meId },
        human
      )
      planning.createWorkItem(
        id,
        { title: `Soon ${id}`, targetDate: '2026-10-09', assigneeId: meId },
        human
      )
    }
    setStages('on-hold', 'done')
    const work = home().getMyWork({ today: '2026-10-07' })
    expect(work.today.map((task) => task.title)).toEqual(['Due p1'])
    expect(work.upcoming.flatMap((day) => day.tasks.map((task) => task.title))).toEqual(['Soon p1'])
    expect(
      home()
        .getAssignedTasks({ personId: meId, today: '2026-10-07' })
        .map((task) => task.projectId)
        .sort()
    ).toEqual(['p1', 'p1'])
    expect(
      home()
        .getPlanMyDay({ today: '2026-10-07' })
        .today.map((task) => task.title)
    ).toEqual(['Due p1'])

    setStages('active', 'done')
    expect(
      home()
        .getMyWork({ today: '2026-10-07' })
        .today.map((task) => task.title)
        .sort()
    ).toEqual(['Due p1', 'Due p2'])
  })

  it('drops their blocker nudges but keeps reminders and agent questions and reviews', () => {
    const due = planning.createWorkItem(
      'p2',
      { title: 'Pay invoice', targetDate: '2026-10-07' },
      human
    )
    const blocked = planning.createWorkItem('p2', { title: 'Lodge return' }, human)
    planning.reportBlocker(blocked.id, 'Need the summary', 'human')
    vi.setSystemTime(new Date(2026, 9, 7, 9, 0))
    const reminders = planning.reminders.dueBy(Date.now(), ['p2'])
    planning.reminders.markDelivered(
      reminders.map((reminder) => reminder.id),
      Date.now()
    )
    setStages('on-hold', 'done')

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
      () => true,
      (entry) =>
        entry.id === 'p2'
          ? {
              questions: [{ id: 'q1', text: 'Which colour?', at: 50, taskId: null }],
              reviews: [{ id: 's1', title: 'Fix the gate', at: 60, taskId: null }]
            }
          : null
    )
    service.registerSource('questions', agents.questions)
    service.registerSource('reviews', agents.reviews)

    const kinds = service.list().items.map((item) => item.kind)
    expect(kinds).toContain('reminder')
    expect(kinds).toContain('question')
    expect(kinds).toContain('review')
    expect(kinds).not.toContain('blocker')
    expect(service.list().items.find((item) => item.kind === 'reminder')?.taskId).toBe(due.id)

    setStages('active', 'done')
    expect(service.list().items.map((item) => item.kind)).toContain('blocker')
  })
})
