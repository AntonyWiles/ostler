import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { BriefingService } = await import('../../electron/services/briefing-service')
const { createMigratedDatabase } = await import('../helpers/database')

function project(id: string, name: string, enabled = true): WatchedProject {
  return { id, name, color: '#3b82f6', enabled } as WatchedProject
}

const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).getTime()

describe('Since you were last here: the briefing (N1.6)', () => {
  const tempDir = useTempDir('ostler-briefing-')
  let planning: InstanceType<typeof PlanningService>
  let people: InstanceType<typeof PeopleService>
  let projects: WatchedProject[]
  let agentsOn: boolean
  let meId: string
  const since = at(6, 18)
  const until = at(7, 8)

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(6, 12))
    const databasePath = await createMigratedDatabase(tempDir())
    projects = [project('p1', 'Website'), project('p2', 'Garden'), project('p3', 'Taxes')]
    agentsOn = false
    planning = new PlanningService(databasePath, () => projects.map((entry) => entry.id))
    people = new PeopleService(databasePath)
    meId = people.ensureMe('Jordan').id
  })

  afterEach(() => {
    planning.close()
    people.close()
    vi.useRealTimers()
  })

  const me = () => ({ kind: 'human' as const, personId: meId })
  const service = () =>
    new BriefingService({
      db: planning.database,
      getProjects: () => projects,
      agentsOn: () => agentsOn,
      agentAttention: (entry) =>
        entry.id === 'p1'
          ? {
              questions: [{ id: 'q1', text: 'Which colour?', at: 5, taskId: null }],
              reviews: [{ id: 's1', title: 'Fix the header', at: 6, taskId: 'w9' }]
            }
          : null
    })
  const add = (projectId: string, title: string, extra: object = {}, actor: object = me()) =>
    planning.createWorkItem(projectId, { title, ...extra }, actor as never)

  it('counts tasks finished and added by who did them, five titles each', () => {
    const before = add('p1', 'From before')
    vi.setSystemTime(at(6, 20))
    for (let index = 1; index <= 7; index++) add('p1', `Agent task ${index}`, {}, { kind: 'agent' })
    const mine = add('p1', 'Mine')
    const imported = add('p1', 'Imported row')
    planning.database
      .prepare("UPDATE planning_work_items SET import_batch_id = 'b1' WHERE id = ?")
      .run(imported.id)
    planning.updateWorkItem(before.id, { status: 'done' }, me())
    planning.updateWorkItem(mine.id, { status: 'done' }, { kind: 'rule', ruleName: 'Escalate' })
    vi.setSystemTime(until)

    const [website] = service().build({ since, until }).projects
    expect(website.projectName).toBe('Website')
    expect(website.added.map((group) => [group.actor, group.name, group.count])).toEqual([
      ['agent', null, 7],
      ['import', null, 1],
      ['person', 'Jordan', 1]
    ])
    expect(website.added[0].tasks).toHaveLength(5)
    expect(website.added[0].tasks[0]).toEqual({ id: expect.any(String), title: 'Agent task 7' })
    expect(website.finished.map((group) => [group.actor, group.name, group.count])).toEqual([
      ['rule', 'Escalate', 1],
      ['person', 'Jordan', 1]
    ])
    expect(website.finished[1].tasks[0].title).toBe('From before')
  })

  it('tells comments, due dates passed while away, and reminders that went off', () => {
    const commented = add('p2', 'Plant roses', { targetDate: '2026-10-06' })
    add('p2', 'Due before away', { targetDate: '2026-10-05' })
    add('p2', 'Due today', { targetDate: '2026-10-07' })
    add('p2', 'Done anyway', { targetDate: '2026-10-06', status: 'done' })
    planning.addComment(commented.id, 'Before', me())
    vi.setSystemTime(at(6, 21))
    planning.addComment(commented.id, 'One', me())
    planning.addComment(commented.id, 'Two', me())
    const reminder = planning.addReminder(commented.id, at(6, 22))
    planning.reminders.markDelivered([reminder.id], at(6, 22))
    vi.setSystemTime(until)

    const [garden] = service().build({ since, until }).projects
    expect(garden.comments).toEqual({
      count: 2,
      tasks: [{ id: commented.id, title: 'Plant roses' }]
    })
    expect(garden.overdue).toEqual({
      count: 1,
      tasks: [{ id: commented.id, title: 'Plant roses' }]
    })
    expect(garden.reminders.count).toBe(1)
    expect(garden.added).toEqual([])
  })

  it('tells agent runs, reviews and questions only while agents are on', () => {
    planning.database
      .prepare(
        `INSERT INTO agent_runs (session_id, project_id, title, provenance, started_at, ended_at,
           outcome, ended_as, updated_at) VALUES (?, 'p1', ?, 'embedded', ?, ?, 'accepted', 'complete', ?)`
      )
      .run('s-old', 'Ran before', at(6, 1), at(6, 2), at(6, 2))
    planning.database
      .prepare(
        `INSERT INTO agent_runs (session_id, project_id, title, provenance, started_at, ended_at,
           outcome, ended_as, updated_at) VALUES (?, 'p1', ?, 'embedded', ?, ?, 'in_review', 'complete', ?)`
      )
      .run('s-new', 'Fix the header', at(6, 19), at(6, 23), at(6, 23))

    expect(service().build({ since, until }).projects).toEqual([])
    agentsOn = true
    const [website] = service().build({ since, until }).projects
    expect(website.runsFinished).toEqual({
      count: 1,
      tasks: [{ id: null, title: 'Fix the header' }]
    })
    expect(website.runsInReview).toEqual({
      count: 1,
      tasks: [{ id: 'w9', title: 'Fix the header' }]
    })
    expect(website.questions).toBe(1)
  })

  it('leaves out projects with nothing and disabled projects, and a quiet span is empty', () => {
    vi.setSystemTime(at(6, 20))
    add('p1', 'Website task')
    add('p3', 'Taxes task')
    vi.setSystemTime(until)
    expect(
      service()
        .build({ since, until })
        .projects.map((entry) => entry.projectName)
    ).toEqual(['Website', 'Taxes'])

    projects = [project('p1', 'Website', false), project('p2', 'Garden'), project('p3', 'Taxes')]
    expect(
      service()
        .build({ since, until })
        .projects.map((entry) => entry.projectName)
    ).toEqual(['Taxes'])
    expect(service().build({ since, until, projectIds: ['p2'] }).projects).toEqual([])
    expect(service().build({ since: at(7, 1), until }).projects).toEqual([])
    expect(() => service().build({ since: -1, until })).toThrow(/since/)
  })
})
