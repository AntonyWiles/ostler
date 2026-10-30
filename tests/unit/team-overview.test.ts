import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({ Notification: class {}, BrowserWindow: class {} }))

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { TeamService } = await import('../../electron/services/team-service')
const { HomeService } = await import('../../electron/services/home-service')
const { teamOverviewQuery } = await import('../../electron/ipc/home-handlers')
const { createMigratedDatabase } = await import('../helpers/database')

const human = { kind: 'human' as const }
/** A Wednesday; its week runs Monday 12 to Sunday 18 October 2026. */
const TODAY = '2026-10-14'
const at = (month: number, day: number, hour = 10) => new Date(2026, month - 1, day, hour).getTime()

function project(id: string, name: string, enabled = true): WatchedProject {
  return { id, name, color: '#336699', enabled } as WatchedProject
}

describe('Team view: each person’s work across projects in one call', () => {
  const tempDir = useTempDir('ostler-team-overview-')
  let planning: InstanceType<typeof PlanningService>
  let people: InstanceType<typeof PeopleService>
  let teams: InstanceType<typeof TeamService>
  let projects: WatchedProject[]
  let meId: string
  let bobId: string
  let catId: string
  let danId: string

  beforeEach(async () => {
    const databasePath = await createMigratedDatabase(tempDir())
    projects = [project('p1', 'Website'), project('p2', 'Garden'), project('p3', 'Old', false)]
    planning = new PlanningService(databasePath, () => projects.map((entry) => entry.id))
    people = new PeopleService(databasePath)
    teams = new TeamService(databasePath)
    meId = people.ensureMe('Jordan').id
    bobId = people.create({ name: 'Bob' }).id
    catId = people.create({ name: 'Cat' }).id
    danId = people.create({ name: 'Dan' }).id
    people.update(meId, { weeklyCapacityHours: 40 })
  })

  afterEach(() => {
    planning.close()
    people.close()
    teams.close()
  })

  const home = () =>
    new HomeService({
      db: planning.database,
      getProjects: () => projects,
      getMeId: () => meId,
      agentsOn: () => false,
      agentAttention: () => null,
      getPeople: () => people.list()
    })
  const overview = (extra: object = {}) => home().getTeamOverview({ today: TODAY, ...extra })
  const add = (projectId: string, title: string, assigneeId: string, extra: object = {}) =>
    planning.createWorkItem(projectId, { title, assigneeId, ...extra }, human)
  const setUpdated = (id: string, updatedAt: number) =>
    planning.database
      .prepare('UPDATE planning_work_items SET updated_at = ? WHERE id = ?')
      .run(updatedAt, id)
  const logTime = (
    workItemId: string,
    projectId: string,
    personId: string,
    start: number,
    seconds: number
  ) =>
    planning.database
      .prepare(
        `INSERT INTO planning_time_entries
           (id, project_id, work_item_id, person_id, started_at, duration_seconds, note, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '', 'manual', ?, ?)`
      )
      .run(`t-${start}-${personId}`, projectId, workItemId, personId, start, seconds, start, start)
  const dayOff = (id: string, personId: string | null, first: string, last: string) =>
    planning.database
      .prepare(
        `INSERT INTO days_off (id, person_id, first_date, last_date, name, source_file, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Leave', NULL, 1, 1)`
      )
      .run(id, personId, first, last)
  const row = (personId: string) => overview().find((entry) => entry.personId === personId)

  it('counts open, overdue, due this week, blocked and stalled work, and leaves done work out', () => {
    add('p1', 'Late', meId, { targetDate: '2026-10-10', status: 'ready' })
    add('p1', 'This week', meId, { targetDate: '2026-10-16', status: 'ready' })
    add('p1', 'Next week', meId, { targetDate: '2026-10-20', status: 'ready' })
    const blocked = add('p2', 'Stuck', meId, { status: 'active' })
    planning.reportBlocker(blocked.id, 'Waiting', 'human')
    const resolved = add('p2', 'Was stuck', meId, { status: 'active' })
    const old = planning.reportBlocker(resolved.id, 'Waiting', 'human')
    planning.resolveBlocker(old.id, 'unblocked', 'sorted', 'human')
    const stalled = add('p2', 'Quiet', meId, { status: 'active' })
    const backlog = add('p2', 'Parked', meId, { status: 'backlog' })
    const done = add('p1', 'Finished', meId, { targetDate: '2026-10-01', status: 'done' })
    const archived = add('p1', 'Archived', meId, { targetDate: '2026-10-01' })
    planning.archiveWorkItem(archived.id, human)
    add('p3', 'Disabled project', meId, { targetDate: '2026-10-01' })
    for (const item of [stalled, backlog, done]) setUpdated(item.id, at(10, 1))

    expect(row(meId)).toMatchObject({
      open: 7,
      overdue: 1,
      dueThisWeek: 1,
      blocked: 1,
      stalled: 1,
      projectIds: ['p1', 'p2']
    })
  })

  it('counts a person’s open tasks that wait for sign-off, once each, and not answered ones', () => {
    const waiting = add('p1', 'Needs a look', bobId)
    const answered = add('p1', 'Looked at', bobId)
    const finished = add('p1', 'Done and waiting', bobId, { status: 'done' })
    const insert = planning.database.prepare(
      `INSERT INTO planning_sign_offs
         (id, project_id, item_kind, item_id, approver_person_id, requested_by_person_id,
          state, note, requested_at, answered_at, updated_at)
       VALUES (?, 'p1', 'task', ?, ?, ?, ?, '', 1, NULL, 1)`
    )
    insert.run('so-1', waiting.id, meId, bobId, 'waiting')
    insert.run('so-2', waiting.id, catId, bobId, 'waiting')
    insert.run('so-3', answered.id, meId, bobId, 'approved')
    insert.run('so-4', finished.id, meId, bobId, 'waiting')
    expect(row(bobId)?.waitingForSignOff).toBe(1)
    expect(row(meId)?.waitingForSignOff ?? 0).toBe(0)
  })

  it('adds up time logged this week across projects, not last week’s', () => {
    const one = add('p1', 'One', meId)
    const two = add('p2', 'Two', meId)
    logTime(one.id, 'p1', meId, at(10, 12), 3600)
    logTime(two.id, 'p2', meId, at(10, 14), 5400)
    logTime(one.id, 'p1', meId, at(10, 9), 7200)
    logTime(two.id, 'p2', bobId, at(10, 13), 1800)
    expect(row(meId)?.hoursThisWeek).toBe(2.5)
    expect(row(bobId)?.hoursThisWeek).toBe(0.5)
    expect(row(bobId)?.open).toBe(0)
  })

  it('takes days off out of this week’s capacity and lists away spans starting soon', () => {
    dayOff('d1', meId, '2026-10-15', '2026-10-15')
    dayOff('d2', meId, '2026-10-30', '2026-11-02')
    dayOff('d3', meId, '2026-12-01', '2026-12-02')
    add('p1', 'Mine', meId)
    const mine = row(meId)!
    expect(mine.capacityThisWeek).toBe(32)
    expect(mine.awayDays).toEqual([{ firstDate: '2026-10-15', lastDate: '2026-10-15' }])
    add('p1', 'Bob’s', bobId)
    expect(row(bobId)!.capacityThisWeek).toBeNull()
  })

  it('shows others’ shared away days, once however many projects share them', () => {
    add('p1', 'Bob’s', bobId)
    const insert = planning.database.prepare(
      `INSERT INTO shared_away (id, project_id, person_id, first_date, last_date, updated_at)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
    insert.run('a1', 'p1', bobId, '2026-10-20', '2026-10-21')
    insert.run('a2', 'p2', bobId, '2026-10-20', '2026-10-21')
    expect(row(bobId)!.awayDays).toEqual([{ firstDate: '2026-10-20', lastDate: '2026-10-21' }])
  })

  it('reports when someone last changed or commented on a task', () => {
    const item = add('p1', 'Bob’s', bobId)
    planning.database
      .prepare(
        `INSERT INTO planning_comments (id, project_id, work_item_id, author_person_id, author_kind, body, created_at, updated_at)
         VALUES ('c1', 'p1', ?, ?, 'human', 'Hi', ?, ?)`
      )
      .run(item.id, bobId, at(10, 13), at(10, 13))
    expect(row(bobId)!.lastActiveAt).toBe(at(10, 13))
    expect(row(meId)).toBeUndefined()
  })

  it('lists a team’s members even with no work, and only them', () => {
    add('p1', 'Bob’s', bobId)
    add('p1', 'Dan’s', danId)
    const team = teams.create({ name: 'Crew', memberIds: [bobId, catId] })
    const rows = overview({ teamId: team.id })
    expect(rows.map((entry) => entry.personId)).toEqual([bobId, catId])
    expect(rows[1]).toMatchObject({ open: 0, overdue: 0, projectIds: [] })
    expect(overview({ teamId: 'nope' })).toEqual([])
    expect(overview().map((entry) => entry.personId)).toEqual([bobId, danId])
  })

  it('narrows to the chosen projects', () => {
    add('p1', 'On p1', bobId)
    add('p2', 'On p2', bobId)
    add('p2', 'Dan on p2', danId)
    expect(row(bobId)!.open).toBe(2)
    const only = overview({ projectIds: ['p1'] })
    expect(only.map((entry) => [entry.personId, entry.open])).toEqual([[bobId, 1]])
  })

  it('includes members of a shared project in scope and sorts by name', () => {
    planning.database
      .prepare(
        `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at)
         VALUES ('p1', 's1', 'x', 'm1', 'd1', 1, 1)`
      )
      .run()
    planning.database
      .prepare(
        `INSERT INTO sync_members (share_id, member_id, person_id, name, public_key, joined_at)
         VALUES ('s1', 'm2', ?, 'Cat', 'k', 1)`
      )
      .run(catId)
    add('p2', 'Bob’s', bobId)
    expect(overview().map((entry) => entry.personId)).toEqual([bobId, catId])
    expect(overview({ projectIds: ['p2'] }).map((entry) => entry.personId)).toEqual([bobId])
  })

  it('checks the query from the renderer', () => {
    const getProject = (id: string) => projects.find((entry) => entry.id === id)!
    expect(
      teamOverviewQuery({ today: TODAY, teamId: 't', projectIds: ['p1'] }, getProject)
    ).toEqual({ today: TODAY, teamId: 't', projectIds: ['p1'] })
    expect(() => teamOverviewQuery(null, getProject)).toThrow()
    expect(() => home().getTeamOverview({ today: 'soon' })).toThrow('YYYY-MM-DD')
  })
})
