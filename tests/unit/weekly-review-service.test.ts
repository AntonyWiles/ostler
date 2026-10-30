import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportAtRisk, WatchedProject } from '../../src/shared/ostler-api'
import { weeklyReviewFilters } from '../../src/shared/planning/weekly-review'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { PeopleService } = await import('../../electron/services/people-service')
const { WeeklyReviewService, reviewSteps, lastWeeklyReview } =
  await import('../../electron/services/weekly-review-service')
const { createMigratedDatabase } = await import('../helpers/database')

const human = { kind: 'human' as const }
const TODAY = '2026-10-16'
const NOW = new Date(2026, 9, 16, 12, 0).getTime()
const DAY = 86_400_000

function project(id: string, name: string, enabled = true) {
  return { id, name, color: '#3b82f6', enabled, estimateUnit: 'hours' } as WatchedProject
}

describe('Weekly review lists (N1.5)', () => {
  const tempDir = useTempDir('ostler-weekly-review-')
  let planning: InstanceType<typeof PlanningService>
  let people: InstanceType<typeof PeopleService>
  let projects: WatchedProject[]
  let meId: string
  let otherId: string
  let atRisk: Map<string, ReportAtRisk>

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const databasePath = await createMigratedDatabase(tempDir())
    projects = [project('p1', 'Website'), project('p2', 'Garden'), project('p3', 'Off', false)]
    planning = new PlanningService(databasePath, () => projects.map((entry) => entry.id))
    people = new PeopleService(databasePath)
    meId = people.ensureMe('Jordan').id
    otherId = people.create({ name: 'Sam' }).id
    atRisk = new Map()
  })

  afterEach(() => {
    planning.close()
    people.close()
    vi.useRealTimers()
  })

  const service = (inboxCount = 0) =>
    new WeeklyReviewService({
      db: planning.database,
      getProjects: () => projects,
      getMeId: () => meId,
      inboxCount: () => inboxCount,
      atRisk: (entry) => atRisk.get(entry.id) ?? null,
      now: () => Date.now()
    })
  const add = (title: string, extra: object = {}, projectId = 'p1') =>
    planning.createWorkItem(projectId, { title, ...extra }, human)
  const titles = (tasks: { title: string }[]) => tasks.map((task) => task.title)
  /** Sets a task's stored times, as if it was written that long ago. */
  const age = (id: string, updatedDaysAgo: number, createdDaysAgo = updatedDaysAgo) =>
    planning.database
      .prepare('UPDATE planning_work_items SET updated_at = ?, created_at = ? WHERE id = ?')
      .run(NOW - updatedDaysAgo * DAY, NOW - createdDaysAgo * DAY, id)

  it('lists overdue tasks across projects, assigned to Me or nobody, oldest due first', () => {
    add('Mine', { targetDate: '2026-10-10', assigneeId: meId })
    add('Nobody', { targetDate: '2026-10-12' }, 'p2')
    add('Sam', { targetDate: '2026-10-11', assigneeId: otherId })
    add('Due today', { targetDate: TODAY })
    add('Done', { targetDate: '2026-10-01', status: 'done' })
    add('Parked', { targetDate: '2026-10-01', someday: true })
    add('Disabled project', { targetDate: '2026-10-01' }, 'p3')
    const review = service().getReview({ today: TODAY })
    expect(titles(review.overdue)).toEqual(['Mine', 'Nobody'])
  })

  it('lists tasks blocked for more than three days, the longest wait first', () => {
    const long = add('Long wait', { status: 'blocked' })
    const longer = add('Longer wait', { status: 'blocked' }, 'p2')
    const fresh = add('Fresh', { status: 'blocked' })
    const setBlockedAt = (id: string, daysAgo: number) => {
      planning.database
        .prepare('DELETE FROM planning_status_history WHERE work_item_id = ?')
        .run(id)
      planning.database
        .prepare(
          "INSERT INTO planning_status_history (work_item_id, from_status, to_status, at) VALUES (?, 'ready', 'blocked', ?)"
        )
        .run(id, NOW - daysAgo * DAY)
    }
    setBlockedAt(long.id, 4)
    setBlockedAt(longer.id, 9)
    setBlockedAt(fresh.id, 2)
    const review = service().getReview({ today: TODAY })
    expect(titles(review.blocked)).toEqual(['Longer wait', 'Long wait'])
    expect(review.blocked[0].since).toBe(NOW - 9 * DAY)
  })

  it('lists open tasks unchanged for 14 days, oldest first, without Someday or hidden ones', () => {
    const old = add('Old')
    const older = add('Older', {}, 'p2')
    const recent = add('Recent')
    const parked = add('Parked', { someday: true })
    const later = add('Shown later', { showFrom: '2026-11-01' })
    const done = add('Done', { status: 'done' })
    age(old.id, 14)
    age(older.id, 30)
    age(recent.id, 13)
    age(parked.id, 40)
    age(later.id, 40)
    age(done.id, 40)
    const review = service().getReview({ today: TODAY })
    expect(titles(review.stale)).toEqual(['Older', 'Old'])
  })

  it('lists every Someday task, the oldest first', () => {
    const a = add('Newer idea', { someday: true })
    const b = add('Old idea', { someday: true }, 'p2')
    add('Not parked')
    age(a.id, 1, 5)
    age(b.id, 1, 50)
    expect(titles(service().getReview({ today: TODAY }).someday)).toEqual([
      'Old idea',
      'Newer idea'
    ])
  })

  it('lists the next two weeks by day, tasks and milestones', () => {
    add('Today', { targetDate: TODAY })
    add('In a week', { targetDate: '2026-10-23' }, 'p2')
    add('Last day', { targetDate: '2026-10-29' })
    add('Too far', { targetDate: '2026-10-30' })
    add('Overdue', { targetDate: '2026-10-15' })
    planning.createMilestone('p1', { name: 'Launch', targetDate: '2026-10-23' })
    planning.createMilestone('p1', { name: 'Later', targetDate: '2026-11-23' })
    const review = service().getReview({ today: TODAY })
    expect(review.upcoming.map((day) => day.date)).toEqual([TODAY, '2026-10-23', '2026-10-29'])
    expect(titles(review.upcoming[1].tasks)).toEqual(['In a week'])
    expect(review.upcoming[1].milestones.map((m) => m.name)).toEqual(['Launch'])
  })

  it('lists late and unforecast milestones from each enabled project’s at-risk section', () => {
    const empty = { overdue: [], blocked: [], conflicts: [], summary: '' }
    atRisk.set('p1', {
      ...empty,
      lateMilestones: [
        {
          milestoneId: 'm1',
          name: 'Launch',
          targetDate: '2026-10-01',
          remaining: 3,
          daysLeft: -15,
          forecast: { kind: 'not-enough-history', reason: '' },
          reason: 'Its date passed 15 days ago'
        }
      ],
      unforecastMilestones: []
    })
    atRisk.set('p2', {
      ...empty,
      lateMilestones: [],
      unforecastMilestones: [{ milestoneId: 'm2', name: 'Beds', reason: 'Not enough history' }]
    })
    atRisk.set('p3', {
      ...empty,
      lateMilestones: [],
      unforecastMilestones: [{ milestoneId: 'm3', name: 'Hidden', reason: '' }]
    })
    const review = service().getReview({ today: TODAY })
    expect(review.milestones.map((m) => [m.projectName, m.name, m.targetDate])).toEqual([
      ['Website', 'Launch', '2026-10-01'],
      ['Garden', 'Beds', null]
    ])
  })

  it('counts the Inbox', () => {
    expect(service(4).getReview({ today: TODAY }).inboxCount).toBe(4)
  })

  it('reads each step in one query, however many projects and tasks', () => {
    for (let index = 0; index < 30; index += 1)
      add(`Task ${index}`, { targetDate: '2026-10-01' }, index % 2 ? 'p1' : 'p2')
    const prepare = vi.spyOn(planning.database, 'prepare')
    service().getReview({ today: TODAY })
    // Overdue, blocked, stale, someday, upcoming tasks and upcoming milestones.
    expect(prepare).toHaveBeenCalledTimes(6)
  })

  it('records a finished review and returns it as the last', () => {
    const reviews = service()
    expect(reviews.last()).toBeNull()
    vi.setSystemTime(NOW - DAY)
    reviews.finish({ overdue: { shown: 2, changed: 1 } })
    vi.setSystemTime(NOW)
    const record = reviews.finish({ inbox: { shown: 3, changed: 3 } })
    expect(reviews.last()).toEqual(record)
    expect(lastWeeklyReview(planning.database)?.finishedAt).toBe(NOW)
  })

  it('checks step counts from the renderer', () => {
    expect(reviewSteps({ stale: { shown: 2, changed: 5 } })).toEqual({
      stale: { shown: 2, changed: 2 }
    })
    expect(() => reviewSteps({ nope: { shown: 1, changed: 0 } })).toThrow(/Unknown review step/)
    expect(() => reviewSteps({ inbox: { shown: -1, changed: 0 } })).toThrow(/whole numbers/)
    expect(() => reviewSteps([])).toThrow()
  })

  it('names the same filters the automation API takes', () => {
    const filters = weeklyReviewFilters(TODAY)
    expect(filters.stale.conditions).toContainEqual({
      field: 'updated',
      op: 'before',
      value: '2026-10-03'
    })
    expect(filters.upcoming.conditions).toContainEqual({
      field: 'due',
      op: 'before',
      value: '2026-10-30'
    })
  })
})
