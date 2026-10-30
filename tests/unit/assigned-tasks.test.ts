import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({ Notification: class {}, BrowserWindow: class {} }))

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { HomeService } = await import('../../electron/services/home-service')
const { assignedTasksQuery, workloadTasksQuery } = await import('../../electron/ipc/home-handlers')
const { createMigratedDatabase } = await import('../helpers/database')

const human = { kind: 'human' as const }
const TODAY = '2026-10-14'

function project(id: string, name: string, enabled = true): WatchedProject {
  return { id, name, color: `#00000${id.slice(-1)}`, enabled } as WatchedProject
}

describe('My work: the assigned tasks query (R3.1)', () => {
  const tempDir = useTempDir('ostler-my-work-')
  let planning: InstanceType<typeof PlanningService>
  let people: InstanceType<typeof PeopleService>
  let projects: WatchedProject[]
  let meId: string
  let bobId: string

  beforeEach(async () => {
    const databasePath = await createMigratedDatabase(tempDir())
    projects = [project('p1', 'Website'), project('p2', 'Garden'), project('p3', 'Old', false)]
    planning = new PlanningService(databasePath, () => projects.map((entry) => entry.id))
    people = new PeopleService(databasePath)
    meId = people.ensureMe('Jordan').id
    bobId = people.create({ name: 'Bob' }).id
  })

  afterEach(() => {
    planning.close()
    people.close()
  })

  const home = () =>
    new HomeService({
      db: planning.database,
      getProjects: () => projects,
      getMeId: () => meId,
      agentsOn: () => false,
      agentAttention: () => null
    })
  const add = (projectId: string, title: string, extra: object = {}) =>
    planning.createWorkItem(projectId, { title, assigneeId: meId, ...extra }, human)
  const titles = (
    query: Partial<Parameters<InstanceType<typeof HomeService>['getAssignedTasks']>[0]>
  ) =>
    home()
      .getAssignedTasks({ personId: meId, today: TODAY, ...query })
      .map((task) => task.title)
      .sort()

  it('leaves out tasks in Someday and tasks shown from a later day (N1.1a)', () => {
    add('p1', 'Shown')
    add('p1', 'Shown from today', { showFrom: TODAY })
    add('p1', 'Later', { showFrom: '2026-10-15' })
    add('p1', 'Someday', { someday: true })
    expect(titles({})).toEqual(['Shown', 'Shown from today'])
  })

  it('lists the person’s live tasks in enabled projects, with project and milestone', () => {
    const milestone = planning.createMilestone('p1', { name: 'Launch' })
    add('p1', 'Mine', { milestoneId: milestone.id, estimate: 3 })
    add('p2', 'Mine too')
    add('p2', 'Bob’s', { assigneeId: bobId })
    add('p2', 'Nobody’s', { assigneeId: null })
    add('p3', 'In a disabled project')
    planning.archiveWorkItem(add('p1', 'Archived').id, human)
    planning.deleteWorkItem(add('p1', 'In the bin').id, human)

    const tasks = home().getAssignedTasks({ personId: meId, today: TODAY })
    expect(tasks.map((task) => task.title).sort()).toEqual(['Mine', 'Mine too'])
    const mine = tasks.find((task) => task.title === 'Mine')!
    expect(mine).toMatchObject({
      projectId: 'p1',
      projectName: 'Website',
      projectColor: '#000001',
      milestoneName: 'Launch',
      estimate: 3,
      estimateUnit: 'points'
    })
    expect(titles({ personId: bobId })).toEqual(['Bob’s'])
  })

  it('still lists the tasks of an archived person', () => {
    add('p1', 'Bob’s', { assigneeId: bobId })
    people.archive(bobId)
    expect(titles({ personId: bobId })).toEqual(['Bob’s'])
  })

  it('narrows to one project, hides done and applies the filter and the search words', () => {
    add('p1', 'Write copy', { priority: 'high', status: 'ready' })
    add('p1', 'Ship it', { priority: 'low', status: 'done' })
    add('p2', 'Plant bulbs', { priority: 'high', targetDate: '2026-10-01' })
    add('p2', 'Mow', { priority: 'medium', labels: ['outside'] })

    expect(titles({ projectId: 'p1' })).toEqual(['Ship it', 'Write copy'])
    expect(titles({ hideDone: true })).toEqual(['Mow', 'Plant bulbs', 'Write copy'])
    expect(
      titles({
        filter: { match: 'all', conditions: [{ field: 'priority', op: 'is', value: ['high'] }] }
      })
    ).toEqual(['Plant bulbs', 'Write copy'])
    expect(
      titles({
        filter: {
          match: 'any',
          conditions: [
            { field: 'status', op: 'is', value: ['done'] },
            { field: 'due', op: 'is', value: 'overdue' }
          ]
        }
      })
    ).toEqual(['Plant bulbs', 'Ship it'])
    expect(
      titles({
        filter: {
          match: 'all',
          conditions: [{ field: 'labels', op: 'hasAny', value: ['outside'] }]
        }
      })
    ).toEqual(['Mow'])
    expect(titles({ query: 'BULB' })).toEqual(['Plant bulbs'])
  })

  it('answers status and priority in SQL', () => {
    add('p1', 'High', { priority: 'high' })
    const db = planning.database
    const prepare = vi.spyOn(db, 'prepare')
    titles({
      filter: { match: 'all', conditions: [{ field: 'priority', op: 'isNot', value: ['low'] }] }
    })
    const sql = String(prepare.mock.calls.at(-1)?.[0])
    expect(sql).toContain('w.priority NOT IN (?)')
    expect(sql).toContain('w.assignee_id = ?')
    expect(sql).toContain('w.deleted_at IS NULL')
  })

  it('checks the query from the renderer', () => {
    const getProject = (id: string) => {
      const found = projects.find((entry) => entry.id === id && entry.enabled)
      if (!found) throw new Error('Project not found')
      return found
    }
    expect(() => assignedTasksQuery({ today: TODAY }, getProject)).toThrow('Choose a person')
    expect(() =>
      assignedTasksQuery({ personId: meId, today: TODAY, projectId: 'p3' }, getProject)
    ).toThrow('Project not found')
    expect(() =>
      assignedTasksQuery({ personId: meId, today: TODAY, filter: { match: 'x' } }, getProject)
    ).toThrow()
    expect(
      assignedTasksQuery(
        { personId: meId, today: TODAY, projectId: 'p1', hideDone: true },
        getProject
      )
    ).toMatchObject({ personId: meId, projectId: 'p1', hideDone: true })
  })

  it('Workload lists everyone’s unfinished tasks up to a day, in the chosen projects (R3.2)', () => {
    add('p1', 'Mine overdue', { targetDate: '2026-09-01' })
    add('p1', 'Bob later', { assigneeId: bobId, startDate: '2026-11-30', targetDate: '2026-12-01' })
    add('p1', 'Bob soon', { assigneeId: bobId, startDate: '2026-11-02', targetDate: '2026-12-01' })
    add('p2', 'Nobody undated', { assigneeId: null })
    planning.updateWorkItem(add('p2', 'Done').id, { status: 'done' }, human)
    add('p3', 'Disabled project')

    const workload = (projectIds?: string[]) =>
      home()
        .getWorkloadTasks({ through: '2026-11-22', projectIds })
        .map((task) => task.title)
        .sort()
    expect(workload()).toEqual(['Bob soon', 'Mine overdue', 'Nobody undated'])
    expect(workload(['p2'])).toEqual(['Nobody undated'])
    expect(() => home().getWorkloadTasks({ through: 'soon' })).toThrow('YYYY-MM-DD')
    const getProject = (id: string) => {
      const found = projects.find((entry) => entry.id === id && entry.enabled)
      if (!found) throw new Error('Project not found')
      return found
    }
    expect(() => workloadTasksQuery({ through: TODAY, projectIds: ['p3'] }, getProject)).toThrow(
      'Project not found'
    )
    expect(workloadTasksQuery({ through: TODAY }, getProject)).toEqual({
      projectIds: null,
      through: TODAY
    })
  })
})
